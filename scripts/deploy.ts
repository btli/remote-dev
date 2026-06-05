#!/usr/bin/env bun
/**
 * Blue-Green Deploy Script
 *
 * Performs zero-downtime-ish deployments by building into an inactive slot
 * while the active slot serves traffic, then swapping.
 *
 * Usage:
 *   bun run scripts/deploy.ts              # Deploy latest main
 *   bun run scripts/deploy.ts --rollback   # Rollback to previous slot
 *   bun run scripts/deploy.ts --status     # Show deploy state
 *   bun run scripts/deploy.ts --init       # Initialize deploy state from current running instance
 *
 * Directory structure:
 *   ~/.remote-dev/deploy/
 *   ├── state.json       # Active slot, commit SHA, timestamps
 *   ├── deploy.lock      # PID-based concurrent deploy prevention
 *   └── deploy.log       # Append-only deploy history
 *
 *   ~/.remote-dev/builds/
 *   ├── blue/             # Build A standalone output
 *   └── green/            # Build B standalone output
 */

import { spawn, spawnSync } from "bun";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  cpSync,
  rmSync,
  appendFileSync,
  renameSync,
  readlinkSync,
  readdirSync,
} from "fs";
import { join, sep, isAbsolute, dirname, resolve, delimiter as pathDelimiter } from "path";
import { homedir, hostname as osHostname } from "os";
import http from "http";
import {
  SSR_PROBE_PATHS,
  isAcceptableSsrStatus,
  restoreStandalone,
  deploySourceDir,
  gitSyncCommands,
  ancestryGuardDecision,
  isSafeDeploySrcToRemove,
  nativeRebuildCommand,
  pathWithRuntimeNodeFirst,
  NATIVE_MODULES_TO_REBUILD,
  shouldRunSqlitePush,
  resolveForgejoMirrorUrl,
} from "./deploy-lib";
import { parseLockContent } from "./deploy-lock";
import {
  acquireDeployFlock,
  adoptInheritedFlock,
  FlockUnavailableError,
  FlockForgedFdError,
  type FlockHandle,
  type FlockLog,
} from "./deploy-flock";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// The LIVE serving dir (where the running next-server's .next/standalone lives
// and where rdv.ts restarts from). Normally this IS the script's own repo root
// (import.meta.dir/..). But the webhook may run the ORIGIN/MASTER copy of this
// script from the deploy-src worktree (remote-dev-6lf3 orchestrator-lag fix), in
// which case import.meta.dir points at deploy-src — the WRONG live dir. The
// webhook therefore passes DEPLOY_PROJECT_ROOT to pin the real live serving dir
// explicitly; honor it when set so restoreSlotToLive / restartViaRdvAsync always
// target the live tree regardless of which copy of deploy.ts is executing.
const PROJECT_ROOT =
  process.env.DEPLOY_PROJECT_ROOT || join(import.meta.dir, "..");
const DATA_DIR = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
const DEPLOY_DIR = join(DATA_DIR, "deploy");
const BUILDS_DIR = join(DATA_DIR, "builds");
// Deploy-owned, persistent detached git worktree pinned to origin/master. Builds
// run HERE, never in PROJECT_ROOT, so a deploy can't wipe a developer/agent's
// in-progress edits in the live tree (remote-dev-yxvy). Lives outside the repo.
const DEPLOY_SRC = deploySourceDir(DATA_DIR);
const SOCKET_DIR = join(DATA_DIR, "run");
const SERVER_DIR = join(DATA_DIR, "server");
const STATE_FILE = join(DEPLOY_DIR, "state.json");
const LOCK_FILE = join(DEPLOY_DIR, "deploy.lock");
const LOG_FILE = join(DEPLOY_DIR, "deploy.log");
const RESULT_FILE = join(DEPLOY_DIR, "last-deploy.json");

const NEXTJS_SOCKET = join(SOCKET_DIR, "nextjs.sock");
const TERMINAL_SOCKET = join(SOCKET_DIR, "terminal.sock");

// The Node binary that actually runs next-server in prod (rdv.ts `prod.nextCmd`
// is `["node", "scripts/standalone-server.js"]`, and `node` on this host's PATH
// is Homebrew's). Native addons (better-sqlite3) MUST be ABI-compatible with
// THIS node. Overridable for non-standard hosts (remote-dev-7wgn).
const RUNTIME_NODE =
  process.env.DEPLOY_RUNTIME_NODE || "/opt/homebrew/bin/node";

const EXTERNAL_URL =
  process.env.DEPLOY_EXTERNAL_URL || "https://dev.bryanli.net";
const HEALTH_CHECK_TIMEOUT_MS = 90_000;
const HEALTH_CHECK_INTERVAL_MS = 3_000;
const SSR_PROBE_TIMEOUT_MS = 30_000;

const PROCESS_STOP_TIMEOUT_MS = 10_000;

type Slot = "blue" | "green";

interface DeployState {
  activeSlot: Slot;
  activeCommit: string;
  deployedAt: string;
  previousSlot: Slot;
  previousCommit: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

function logDeploy(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // Log file write failed, continue anyway
  }
}

function logError(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ERROR: ${message}`;
  console.error(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // Log file write failed, continue anyway
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Directory setup
// ─────────────────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [
    DEPLOY_DIR,
    BUILDS_DIR,
    join(BUILDS_DIR, "blue"),
    join(BUILDS_DIR, "green"),
    SOCKET_DIR,
    SERVER_DIR,
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy state
// ─────────────────────────────────────────────────────────────────────────────

function readDeployState(): DeployState | null {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {
    logError("Failed to read deploy state");
  }
  return null;
}

function writeDeployState(state: DeployState): void {
  const tmpFile = STATE_FILE + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  // Atomic rename
  renameSync(tmpFile, STATE_FILE);
}

interface DeployResult {
  status: "in_progress" | "success" | "failed";
  requestedCommit: string;
  activeCommit: string | null;
  stage: string; // start | build | migration | health-local | health-external | done
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

function writeDeployResult(result: DeployResult): void {
  try {
    const tmpFile = RESULT_FILE + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(result, null, 2));
    renameSync(tmpFile, RESULT_FILE);
  } catch {
    // Best-effort; a missing result record degrades to a poll timeout, which
    // CI treats as a failed deploy — the correct fail-safe direction.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock management — OS flock(2) (remote-dev-v7gi flock redesign)
//
// The deploy mutex is an OS `flock(2)` advisory lock on deploy.lock (held by
// scripts/deploy-flock.ts via bun:ffi). The kernel guarantees atomic mutual
// exclusion AND auto-releases the lock on holder death, so the userland
// stale-reclaim protocol that previous rounds kept re-racing is GONE. deploy.lock
// also doubles as the PID-visibility file (PID-liveness readers — the status
// route, watchdog, `--status` — parse it without bun:ffi).
//
// Two locking roles:
//   - DEFAULT (PROJECT_ROOT entry): acquire the flock here, bootstrap deploy-src,
//     then SPAWN the fresh origin/master deploy-src deploy.ts with `--skip-lock`,
//     passing the LOCKED fd as the child's fd 3. The kernel keeps the flock held
//     across the handoff (the child inherits the same open file description).
//   - CHILD (`--skip-lock`): adopt the inherited fd 3 (after verifying it IS the
//     real deploy.lock inode — a forged fd is rejected), write OUR pid in place,
//     run the deploy body, release (unlock + close — deploy.lock is a PERMANENT
//     file that is NEVER unlinked) in a single finally.
// ─────────────────────────────────────────────────────────────────────────────

const FLOCK_LOG: FlockLog = {
  info: (msg) => logDeploy(msg),
  warn: (msg) => logError(msg),
};

// The inherited locked fd index when spawned as a `--skip-lock` child. The parent
// passes its locked fd as the child's fd 3 (Bun.spawn stdio index 3); the env var
// names that descriptor so the child can adopt it.
const CHILD_LOCK_FD = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Process management
// ─────────────────────────────────────────────────────────────────────────────

function readPid(file: string): number | null {
  try {
    if (existsSync(file)) {
      const pid = parseInt(readFileSync(file, "utf-8").trim());
      return isNaN(pid) ? null : pid;
    }
  } catch {
    // Ignore
  }
  return null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Liveness probe for the instance-lock holder. Unlike isProcessRunning above
// (which treats EPERM as "dead"), this mirrors instance-lock.ts's isPidAlive:
// EPERM means the process EXISTS but is owned by another user, so it is alive.
// We MUST err toward "alive" here so the deploy never deletes a live lock it
// merely can't signal — wrongly removing a held lock is the failure this
// ownership check exists to prevent.
function isLockHolderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === "EPERM";
  }
}

// Kill an entire process group by negative PID. Servers are spawned
// `detached: true` so each is its own session/pgid leader — signalling
// `-pid` reaches every descendant (tsx wrapper + actual node server)
// instead of only the outer `bun run tsx` process.
//
// Swallow ESRCH (group already empty) and EPERM (kernel returns EPERM on
// some platforms once the leader has been reaped and the pgrp slot is
// stale) — both indicate the group is no longer signalable, which is the
// success condition we want.
function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ESRCH" && code !== "EPERM") {
      throw err;
    }
  }
}

function stopCurrentServers(): void {
  logDeploy("Stopping current servers...");

  const nextPid = readPid(join(SERVER_DIR, "next.pid"));
  const terminalPid = readPid(join(SERVER_DIR, "terminal.pid"));

  const pidsToStop: Array<{ pid: number; name: string }> = [];
  if (nextPid && isProcessRunning(nextPid)) {
    pidsToStop.push({ pid: nextPid, name: "Next.js" });
  }
  if (terminalPid && isProcessRunning(terminalPid)) {
    pidsToStop.push({ pid: terminalPid, name: "Terminal Server" });
  }

  // Send SIGTERM to the whole group of each server
  for (const { pid, name } of pidsToStop) {
    logDeploy(`Sending SIGTERM to ${name} process group (PID: ${pid})`);
    killProcessGroup(pid, "SIGTERM");
  }

  // Wait for all leaders to exit (descendants die with — or before — the leader)
  const deadline = Date.now() + PROCESS_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const stillRunning = pidsToStop.filter((p) => isProcessRunning(p.pid));
    if (stillRunning.length === 0) break;
    spawnSync(["sleep", "0.2"]);
  }

  // SIGKILL the group for any leader still alive
  for (const { pid, name } of pidsToStop) {
    if (isProcessRunning(pid)) {
      logDeploy(`Force killing ${name} process group (PID: ${pid})`);
      killProcessGroup(pid, "SIGKILL");
    }
  }

  // Clean up stale sockets
  for (const sock of [NEXTJS_SOCKET, TERMINAL_SOCKET]) {
    if (existsSync(sock)) {
      try {
        unlinkSync(sock);
      } catch {
        // Ignore
      }
    }
  }

  // Clean up PID files
  for (const pidFile of ["next.pid", "terminal.pid"]) {
    const file = join(SERVER_DIR, pidFile);
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      // Ignore
    }
  }

  // Clear a STALE instance lock (src/lib/instance-lock.ts). A SIGKILLed
  // terminal server can't release its own lock on the way out, and a leftover
  // lock would block the restart we're about to trigger via rdv.ts. The deploy
  // lock already serializes deploys, but a manual out-of-band `rdv:prod` could
  // hold a live lock — so we mirror releaseInstanceLock()'s defensiveness and
  // only remove the lock when it's same-host AND its holder PID is dead. A
  // live-owner lock is preserved (we warn instead). Only deploy.ts clears the
  // lock; rdv.ts manual start must NOT, so it preserves the double-start guard.
  const instanceLock = join(DATA_DIR, "instance.lock");
  try {
    if (existsSync(instanceLock)) {
      let lockPid: number | null = null;
      let lockHost: string | null = null;
      try {
        const parsed = JSON.parse(readFileSync(instanceLock, "utf-8"));
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.pid === "number") lockPid = parsed.pid;
          if (typeof parsed.hostname === "string") lockHost = parsed.hostname;
        }
      } catch {
        // Unreadable/malformed lock → treat as stale and remove below.
      }

      const sameHost = lockHost === null || lockHost === osHostname();
      const holderAlive = lockPid !== null && isLockHolderAlive(lockPid);

      if (sameHost && !holderAlive) {
        unlinkSync(instanceLock);
        logDeploy(
          `Removed stale instance lock (pid=${lockPid ?? "?"}, host=${lockHost ?? "?"})`,
        );
      } else {
        logError(
          `Instance lock held by a live process (pid=${lockPid ?? "?"}, host=${lockHost ?? "?"}) — leaving it in place`,
        );
      }
    }
  } catch {
    // Ignore
  }

  logDeploy("Servers stopped");
}

// Note: an in-process `startServers()` used to live here, but the live deploy
// path goes through restartViaRdvAsync() (which re-execs rdv.ts under a login
// shell to recover the full locale/PATH environment). The direct-spawn version
// was unused and has been removed; see git history for the previous form.

function restartViaRdvAsync(): void {
  logDeploy("Starting servers via login shell...");
  // Use a login shell to get the user's full environment (locale, PATH,
  // shell config, etc.) — this is the only way to exactly replicate the
  // environment that `nohup bun run rdv:prod` gets when run manually.
  const shell = process.env.SHELL || "/bin/zsh";
  const proc = spawn({
    cmd: [shell, "-l", "-c", `cd ${PROJECT_ROOT} && exec bun run scripts/rdv.ts start prod`],
    cwd: PROJECT_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.pid) {
    logDeploy(`rdv.ts started via login shell (PID: ${proc.pid})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

function runCommand(
  cmd: string[],
  cwd: string,
  description: string
): boolean {
  logDeploy(`Running: ${description}`);
  const result = spawnSync(cmd, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  // Log stdout/stderr to deploy log for debugging when spawned detached
  const stdout = result.stdout?.toString().trim();
  const stderr = result.stderr?.toString().trim();
  if (stdout) {
    for (const line of stdout.split("\n").slice(-20)) {
      logDeploy(`  ${line}`);
    }
  }
  if (result.exitCode !== 0) {
    if (stderr) {
      for (const line of stderr.split("\n").slice(-20)) {
        logError(`  ${line}`);
      }
    }
    logError(`${description} failed with exit code ${result.exitCode}`);
    return false;
  }
  return true;
}

// Commit helpers default to PROJECT_ROOT but accept an explicit cwd. The
// post-build "what did we actually ship" reads MUST use DEPLOY_SRC (the
// origin/master tree we built from) — PROJECT_ROOT's HEAD is no longer reset to
// origin/master per deploy (remote-dev-yxvy), so reading the deployed commit
// from PROJECT_ROOT would be stale and break the CI activeCommit==pushed-SHA
// check. Pre-build fallbacks and `init` legitimately read PROJECT_ROOT.
function getGitCommit(cwd: string = PROJECT_ROOT): string {
  const result = spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd });
  return result.stdout?.toString().trim() || "unknown";
}

function getGitCommitFull(cwd: string = PROJECT_ROOT): string {
  const result = spawnSync(["git", "rev-parse", "HEAD"], { cwd });
  return result.stdout?.toString().trim() || "unknown";
}

// Is DEPLOY_SRC a USABLE git worktree right now? We validate with git, NOT with
// `existsSync(DEPLOY_SRC/.git)`: a worktree's `.git` is a FILE that lingers after
// `git worktree prune` (its registration removed, the file dangling), and a
// half-removed/corrupt checkout can also leave that file behind — file presence
// would send such a path down the refresh path and abort with a confusing
// `git fetch failed`. `git rev-parse --is-inside-work-tree` exiting 0 is the
// authoritative "this is a working tree git can operate on" signal.
function deploySrcIsWorktree(): boolean {
  if (!existsSync(DEPLOY_SRC)) return false;
  const res = spawnSync(
    ["git", "-C", DEPLOY_SRC, "rev-parse", "--is-inside-work-tree"],
    { cwd: DEPLOY_SRC, stdout: "pipe", stderr: "pipe" },
  );
  return res.exitCode === 0;
}

// Remove a pruned/corrupt DEPLOY_SRC so it can be recreated cleanly. DEPLOY_SRC is
// a deploy-OWNED, fully reproducible path (just a detached checkout of
// origin/master + a cloned node_modules), so removing it is safe. Defense in
// depth: refuse to rm anything whose path is not exactly the derived
// `…/deploy-src`, so a future refactor that mis-wires DATA_DIR can never delete
// an unintended directory.
function removeStaleDeploySrc(): boolean {
  if (!isSafeDeploySrcToRemove(DEPLOY_SRC, sep)) {
    logError(
      `Refusing to remove unexpected deploy-src path '${DEPLOY_SRC}' ` +
        `(does not end with '${sep}deploy-src') — leaving it in place.`,
    );
    return false;
  }
  try {
    rmSync(DEPLOY_SRC, { recursive: true, force: true });
    return true;
  } catch (err) {
    logError(`Failed to remove stale deploy-src '${DEPLOY_SRC}': ${String(err)}`);
    return false;
  }
}

// Warm DEPLOY_SRC/node_modules from PROJECT_ROOT so the first build isn't a cold
// 5-10min `bun install`. Uses APFS clonefile (`cp -cR`) — the same copy-on-write
// trick as scripts/worktree-warm.sh, whose relative-symlink layout stays valid
// after the clone. We deliberately do NOT symlink node_modules (Turbopack 16
// rejects a node_modules symlink pointing out of the worktree root — see
// CLAUDE.md). On any failure we just warn: the subsequent `bun install
// --frozen-lockfile` will materialize node_modules itself, only slower.
function warmDeploySrcNodeModules(): void {
  const srcModules = join(PROJECT_ROOT, "node_modules");
  const destModules = join(DEPLOY_SRC, "node_modules");
  if (!existsSync(srcModules) || existsSync(destModules)) {
    return;
  }
  logDeploy("Warming deploy-src node_modules via clonefile...");
  // `cp -cR` = APFS copy-on-write clone (near-instant); falls back below.
  const cloned = runCommand(
    ["cp", "-cR", srcModules, destModules],
    PROJECT_ROOT,
    "clone node_modules into deploy-src",
  );
  if (!cloned) {
    logDeploy(
      "WARNING: node_modules clonefile failed; bun install --frozen-lockfile will populate it (slower)",
    );
  }
}

// Ensure the deploy-owned source worktree exists and is pinned to origin/master,
// then return true on success. Building from this isolated, detached worktree
// (instead of PROJECT_ROOT) is what guarantees a deploy NEVER touches the live
// dev/agent tree (remote-dev-yxvy). Idempotent: creates the worktree on first
// run (and warms its node_modules), otherwise fetches + hard-resets it.
function ensureDeploySrcAtOrigin(): boolean {
  const firstCreate = !deploySrcIsWorktree();

  if (firstCreate) {
    // SELF-HEAL: a path exists at DEPLOY_SRC but git doesn't recognize it as a
    // working tree (pruned registration with a dangling .git file, or a
    // corrupt/half-removed checkout). DEPLOY_SRC is deploy-owned and fully
    // reproducible, so wipe it and recreate from scratch instead of wedging
    // every future deploy with a confusing `git fetch failed`.
    if (existsSync(DEPLOY_SRC)) {
      logDeploy(
        `WARNING: deploy-src is not a valid worktree (pruned/corrupt); recreating: ${DEPLOY_SRC}`,
      );
      if (!removeStaleDeploySrc()) {
        return false;
      }
    }
    // Drop any stale .git/worktrees/<name> registration so the re-add below
    // isn't blocked by "<path> already registered" after we removed the dir.
    runCommand(
      ["git", "-C", PROJECT_ROOT, "worktree", "prune"],
      PROJECT_ROOT,
      "git worktree prune (clear stale deploy-src registration)",
    );
    logDeploy(`Creating deploy source worktree at ${DEPLOY_SRC} (detached @ origin/master)...`);
  } else {
    logDeploy(`Refreshing deploy source worktree ${DEPLOY_SRC} to origin/master...`);
  }

  // fetch (+ worktree add on first create) — see gitSyncCommands for the exact
  // ordered argv arrays per branch.
  const [fetchCmd, secondCmd] = gitSyncCommands(PROJECT_ROOT, DEPLOY_SRC, firstCreate);
  const cwd = firstCreate ? PROJECT_ROOT : DEPLOY_SRC;

  if (!runCommand(fetchCmd, cwd, "git fetch origin (deploy-src)")) {
    return false;
  }

  if (firstCreate) {
    if (!runCommand(secondCmd, PROJECT_ROOT, "git worktree add deploy-src @ origin/master")) {
      return false;
    }
    // First materialization: clone node_modules so the first build is fast.
    warmDeploySrcNodeModules();
    return true;
  }

  // Existing worktree refresh. Preserve the "only ever build origin/master"
  // safety property: confirm DEPLOY_SRC's HEAD is an ancestor of origin/master
  // before the hard reset. DEPLOY_SRC is detached at origin/master so this is
  // trivially true, but we keep + log the guard so a surprise (e.g. someone
  // committed into the deploy worktree by hand) is refused rather than silently
  // discarded — mirroring the original PROJECT_ROOT divergence guard.
  const ancestry = spawnSync(
    ["git", "-C", DEPLOY_SRC, "merge-base", "--is-ancestor", "HEAD", "origin/master"],
    { cwd: DEPLOY_SRC, stdout: "pipe", stderr: "pipe" },
  );
  const decision = ancestryGuardDecision(ancestry.exitCode ?? -1);
  if (decision === "diverged") {
    logError(
      "deploy-src HEAD has diverged from origin/master (commits not on origin?). " +
        "Refusing to hard-reset and risk losing them; resolve deploy-src manually.",
    );
    return false;
  }
  if (decision === "git-error") {
    logError(
      `git merge-base --is-ancestor failed in deploy-src (exit ${ancestry.exitCode}): ` +
        (ancestry.stderr?.toString().trim() ||
          "unknown git error (origin/master ref missing after a bad fetch?)"),
    );
    return false;
  }

  // Safe now — DEPLOY_SRC is the deploy's OWN detached tree, no dev work lives here.
  return runCommand(secondCmd, DEPLOY_SRC, "git reset --hard origin/master (deploy-src)");
}

// Defense-in-depth: walk a freshly-synced source tree and remove any DANGLING
// symlinks (symlink whose resolved target does not exist). Next.js
// `output: "standalone"` copies tracked symlinks by resolving them to their real
// path; a committed broken symlink (target untracked / machine-local) makes that
// copyfile ENOENT and fails the whole build at the build stage. Pruning them here
// — after the tree is reset to origin/master, before `bun run build` — means a
// future broken symlink slipping into the repo can never silently wedge prod.
//
// HARD EXCLUSIONS: never descend into `node_modules` (bun's isolated layout is
// built from valid RELATIVE symlinks that can momentarily look unresolved during
// traversal — touching it would corrupt the install) or `.git`. Idempotent: a
// clean tree prunes nothing and logs a single debug line.
function pruneDanglingSymlinks(root: string): void {
  const SKIP_DIRS = new Set(["node_modules", ".git"]);
  const pruned: string[] = [];

  const walk = (dir: string): void => {
    let entries: import("fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logError(`pruneDanglingSymlinks: cannot read ${dir}: ${String(err)}`);
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        // Resolve the link target relative to its own directory (POSIX semantics)
        // so a relative target like "../../x" is checked against the right base.
        let target: string;
        try {
          const raw = readlinkSync(full);
          target = isAbsolute(raw) ? raw : resolve(dirname(full), raw);
        } catch (err) {
          logError(`pruneDanglingSymlinks: cannot readlink ${full}: ${String(err)}`);
          continue;
        }
        if (!existsSync(target)) {
          try {
            rmSync(full);
            pruned.push(full);
          } catch (err) {
            logError(`pruneDanglingSymlinks: failed to remove dangling ${full}: ${String(err)}`);
          }
        }
        // Never traverse THROUGH a symlink (no recursion on link entries).
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      }
    }
  };

  walk(root);

  if (pruned.length === 0) {
    logDeploy(`No dangling symlinks in ${root}`);
    return;
  }
  logDeploy(`Pruned ${pruned.length} dangling symlink(s) from ${root}:`);
  for (const p of pruned) {
    logDeploy(`  removed dangling symlink: ${p}`);
  }
}

// Rebuild native addons (better-sqlite3) FROM SOURCE against the runtime Node so
// their ABI matches the node that runs next-server (remote-dev-7wgn). Runs in
// DEPLOY_SRC AFTER `bun install` and BEFORE `bun run build`, so Next's standalone
// trace copies the freshly-built `.node` into the served bundle. Best-effort: a
// rebuild failure (missing toolchain, etc.) must NOT abort an otherwise-good
// deploy — bun's prebuilt binary stays in place and the startup self-check in
// src/instrumentation.ts will loudly flag any resulting ABI mismatch. We prepend
// the runtime node's dir to PATH so npm/node-gyp compile against the right
// headers regardless of what `node` the deploy shell would otherwise resolve.
function rebuildNativeModules(cwd: string): void {
  if (!existsSync(RUNTIME_NODE)) {
    logDeploy(
      `WARNING: runtime node not found at ${RUNTIME_NODE}; skipping native-module rebuild. ` +
        `better-sqlite3 will use bun's prebuilt binary (set DEPLOY_RUNTIME_NODE if the path differs).`,
    );
    return;
  }

  const rebuildPath = pathWithRuntimeNodeFirst(
    RUNTIME_NODE,
    process.env.PATH ?? "",
    pathDelimiter,
    dirname,
  );

  logDeploy(
    `Rebuilding native modules [${NATIVE_MODULES_TO_REBUILD.join(", ")}] against ${RUNTIME_NODE}...`,
  );
  const result = spawnSync(nativeRebuildCommand(), {
    cwd,
    env: { ...process.env, PATH: rebuildPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout?.toString().trim();
  const stderr = result.stderr?.toString().trim();
  if (stdout) {
    for (const line of stdout.split("\n").slice(-10)) logDeploy(`  ${line}`);
  }
  if (result.exitCode !== 0) {
    if (stderr) {
      for (const line of stderr.split("\n").slice(-15)) logError(`  ${line}`);
    }
    logError(
      `Native-module rebuild failed (exit ${result.exitCode}); continuing with bun's prebuilt binary. ` +
        `If the runtime Node's ABI differs, the startup NativeModuleCheck will flag it.`,
    );
    return;
  }
  logDeploy("Native modules rebuilt against runtime Node");
}

function buildSlot(slot: Slot): boolean {
  const buildDir = join(BUILDS_DIR, slot);
  const standaloneDir = join(buildDir, "standalone");
  const startTime = Date.now();

  logDeploy(`Building into ${slot} slot...`);

  // Step 1: Sync the deploy-owned source worktree (DEPLOY_SRC) to origin/master.
  // This is an ISOLATED, persistent detached worktree outside the repo — NOT
  // PROJECT_ROOT — so the hard reset can never wipe a developer/agent's
  // in-progress edits in the live tree (remote-dev-yxvy). The divergence guard
  // is preserved (see ensureDeploySrcAtOrigin) so we still only ever build
  // origin/master.
  if (!ensureDeploySrcAtOrigin()) {
    return false;
  }

  // Step 1b: Purge UNTRACKED files from the synced source tree BEFORE building.
  // Next 16 + Turbopack over-traces the whole workspace root into the one build
  // entry that `outputFileTracingExcludes` does NOT filter
  // (`instrumentation.js.nft.json`), so the `output:"standalone"` copy step walks
  // tracked dev-tooling dirs (`.agents/`, `.claude/`, …). That over-trace is
  // non-fatal ONLY while every traced path still exists at copy time. The Step 1
  // sync is `git reset --hard origin/master`, which restores tracked files but
  // does NOT remove untracked ones — so a stale untracked phantom left in
  // deploy-src (observed: a leftover `.agents/skills/gemini-api-dev` dir) gets
  // pulled into the trace, then vanishes/has-no-tracked-source at copy time and
  // the standalone copy ENOENTs (`copyfile … .agents/skills/gemini-api-dev …`),
  // aborting the entire build and wedging prod deploys. `git clean -fd` removes
  // those untracked non-ignored files+dirs so the trace can't dangle. `-x` is
  // deliberately OMITTED: it would also delete gitignored `node_modules`/`.next`
  // (the APFS-warmed deps + prior build), forcing a slow cold reinstall/rebuild.
  // This is best-effort/non-fatal — a `git clean` hiccup must never block a
  // deploy, and the build succeeds anyway when there's no phantom (the ENOENT is
  // the exception, not the rule). It complements Step 1c's
  // pruneDanglingSymlinks, which only removes TRACKED dangling symlinks and does
  // nothing about untracked phantoms.
  if (!runCommand(["git", "clean", "-fd"], DEPLOY_SRC, "git clean -fd (deploy-src)")) {
    logError(
      "git clean -fd (deploy-src) failed; continuing (untracked phantoms, if any, may still cause a standalone-copy ENOENT)"
    );
  }

  // Step 1c: Prune dangling symlinks from the synced source tree BEFORE building.
  // Next's standalone copy resolves symlinks to their real path and copyfile-
  // ENOENTs on a committed broken symlink, failing the whole build. Pruning here
  // (after the reset to origin/master, before `bun run build`) makes a future
  // broken symlink unable to silently wedge prod. node_modules is excluded — its
  // relative symlinks are valid and must never be touched.
  pruneDanglingSymlinks(DEPLOY_SRC);

  // Step 2: Install dependencies (in the deploy-src worktree)
  if (
    !runCommand(
      ["bun", "install", "--frozen-lockfile"],
      DEPLOY_SRC,
      "bun install"
    )
  ) {
    return false;
  }

  // Step 2b: Rebuild native addons (better-sqlite3) from source against the
  // RUNTIME node BEFORE the Next build, so the standalone trace copies an
  // ABI-correct `.node` into the served bundle (remote-dev-7wgn). Best-effort.
  rebuildNativeModules(DEPLOY_SRC);

  // Step 3: Build rdv CLI (soft requirement — warn and continue if cargo is unavailable)
  const cargoPath = join(homedir(), ".cargo", "bin", "cargo");
  const cargoBin = existsSync(cargoPath) ? cargoPath : "cargo";
  if (
    !runCommand(
      [cargoBin, "install", "--path", join(DEPLOY_SRC, "crates", "rdv")],
      DEPLOY_SRC,
      "cargo install rdv CLI"
    )
  ) {
    logDeploy("WARNING: rdv CLI build failed (cargo not available?), continuing without it");
  }

  // Step 4: Build Next.js (in the deploy-src worktree)
  if (!runCommand(["bun", "run", "build"], DEPLOY_SRC, "bun run build")) {
    return false;
  }

  // Step 5: Copy build output to slot directory (from DEPLOY_SRC, not PROJECT_ROOT)
  logDeploy(`Copying build to ${slot} slot...`);

  // Clean previous build in this slot
  if (existsSync(standaloneDir)) {
    rmSync(standaloneDir, { recursive: true, force: true });
  }
  mkdirSync(standaloneDir, { recursive: true });

  // Copy .next/standalone
  const srcStandalone = join(DEPLOY_SRC, ".next", "standalone");
  if (!existsSync(srcStandalone)) {
    logError("No .next/standalone directory found after build");
    return false;
  }
  cpSync(srcStandalone, standaloneDir, { recursive: true });

  // Copy static assets into standalone
  const srcStatic = join(DEPLOY_SRC, ".next", "static");
  const destStatic = join(standaloneDir, ".next", "static");
  if (existsSync(srcStatic)) {
    cpSync(srcStatic, destStatic, { recursive: true });
  }

  // Copy public directory
  const srcPublic = join(DEPLOY_SRC, "public");
  const destPublic = join(standaloneDir, "public");
  if (existsSync(srcPublic)) {
    cpSync(srcPublic, destPublic, { recursive: true });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logDeploy(`Build completed in ${elapsed}s (commit: ${getGitCommit(DEPLOY_SRC)})`);

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database migration (runs between stop and start for safety)
// ─────────────────────────────────────────────────────────────────────────────

function runMigration(): boolean {
  // Migrations run from DEPLOY_SRC, NOT PROJECT_ROOT (remote-dev-yxvy). The live
  // prod DB is selected by ENV (DATABASE_URL / the ~/.remote-dev libsql path),
  // not by cwd — so running here still targets the live DB; only the SCHEMA
  // SOURCE changes. db:push reads drizzle.config → src/db/schema.ts relative to
  // cwd, and the backfill scripts likewise import schema/code relative to cwd.
  // Post-yxvy PROJECT_ROOT is intentionally NEVER synced to origin/master, so
  // pushing from PROJECT_ROOT would migrate the live DB to the dev checkout's
  // STALE/mid-edit schema while the served build is origin/master — a schema/code
  // mismatch on the live DB. Running from DEPLOY_SRC (pinned to origin/master)
  // keeps the pushed schema in lockstep with the built+served code.
  //
  // In the normal deploy flow buildSlot() runs first, so DEPLOY_SRC already
  // exists and has its node_modules. Be defensive anyway: ALWAYS re-pin it to
  // origin/master before migrating — ensureDeploySrcAtOrigin() is idempotent
  // (fetch + reset --hard origin/master, a cheap no-op when already pinned), so
  // calling it again here GUARANTEES we never push from a present-but-stale or
  // diverged worktree. (A bare `existsSync(DEPLOY_SRC)` short-circuit would skip
  // the pin and migrate from an unvalidated schema.) If it can't be materialized
  // or pinned, refuse rather than silently fall back to PROJECT_ROOT's stale
  // schema.
  if (!ensureDeploySrcAtOrigin()) {
    logError(
      "Migration aborted: deploy-src worktree could not be pinned to origin/master, " +
        "refusing to push PROJECT_ROOT's (unsynced) schema to the live DB.",
    );
    return false;
  }

  // db:push is `drizzle-kit push --dialect sqlite`, whose getDatabasePath()
  // returns DATABASE_URL verbatim. The webhook now forwards DATABASE_URL
  // (remote-dev-6lf3), so on a Postgres host a `postgresql://…` URL would be fed
  // to the SQLite drizzle-kit push → error → hard abort → every webhook deploy
  // blocked. Gate it: only SQLite uses db:push; the PG schema is applied via the
  // drizzle/pg migrate-on-boot path (src/db/migrate.ts), so skip the push on PG.
  // The backfills + db:verify-backfills below are dialect-portable and still run.
  if (!shouldRunSqlitePush(process.env.DATABASE_URL)) {
    logDeploy(
      "DATABASE_URL is Postgres — skipping db:push (SQLite-only); PG schema is applied via migrate-on-boot",
    );
  } else if (!runCommand(
    ["bun", "run", "db:push"],
    DEPLOY_SRC,
    "database migration"
  )) {
    return false;
  }

  // Schema drift guard (remote-dev-9qni): db:push silently SKIPS data-loss
  // changes (e.g. adding a NOT NULL column to a populated table) and exits 0,
  // leaving the live schema drifted from schema.ts — which already broke prod
  // (notification_event lost columns → notifications/push dead). Verify the live
  // SQLite schema matches schema.ts and ABORT the deploy loudly on any drift,
  // rather than going green with a broken schema. SQLite-only (PG: migrate-on-boot).
  if (shouldRunSqlitePush(process.env.DATABASE_URL) && !runCommand(
    ["bun", "run", "db:check-drift"],
    DEPLOY_SRC,
    "schema drift verification",
  )) {
    logError(
      "Schema drift verification FAILED — db:push left the live schema out of sync " +
        "with schema.ts (a data-loss change was likely skipped). Aborting deploy.",
    );
    return false;
  }

  // Backfill github_account_metadata for any OAuth accounts missing metadata
  runCommand(
    ["bun", "run", "db:migrate-github-accounts"],
    DEPLOY_SRC,
    "GitHub account metadata backfill"
  );

  // Backfill the user_email resolution index: every existing user without a
  // primary user_email row gets one (idempotent). Runs after db:push created
  // the table, so multi-email resolution works for pre-existing accounts.
  //
  // GUARDED (defense-in-depth): unlike the best-effort github-accounts backfill
  // above, this one gates auth — so a failure ABORTS the deploy (mirrors the
  // db:push guard) rather than serving with an incomplete index. The
  // self-healing resolver fallback (src/lib/user-identity.ts) already keeps
  // resolution correct if this is skipped, but failing the deploy surfaces the
  // problem instead of silently degrading to per-request lazy heals.
  if (!runCommand(
    ["bun", "run", "db:backfill-user-emails"],
    DEPLOY_SRC,
    "user_email index backfill"
  )) {
    return false;
  }

  // GENERALIZABLE POST-CONDITION GUARD (remote-dev-6lf3). After migrations +
  // backfills, assert each registered backfill actually TOOK EFFECT against the
  // LIVE DB (e.g. every user has a primary user_email row). This closes the gap
  // that let the #338 deploy go green with an empty user_email table: the live
  // server's deploy.ts orchestrator was STALE and never ran the backfill step,
  // and nothing surfaced it. The check runs from DEPLOY_SRC (origin/master), so
  // it can't itself be skipped by an out-of-date orchestrator, and it targets
  // the same live DB (resolution is env-only, not cwd-relative). A failure
  // ABORTS the deploy loudly rather than serving with a broken invariant. New
  // backfills register a post-condition in src/db/backfill-postcondition.ts.
  if (!runCommand(
    ["bun", "run", "db:verify-backfills"],
    DEPLOY_SRC,
    "backfill post-condition verification"
  )) {
    logError(
      "Backfill post-condition verification FAILED — a backfill did not take effect on the live DB. " +
        "Aborting deploy rather than going green with a broken invariant.",
    );
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health checks
// ─────────────────────────────────────────────────────────────────────────────

function waitForSocket(
  socketPath: string,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (existsSync(socketPath)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

function httpGetOverSocket(
  socketPath: string,
  path: string,
  headers?: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        socketPath,
        path,
        headers: { host: "localhost", ...headers },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      }
    );
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

async function healthCheckLocal(): Promise<boolean> {
  logDeploy("Health check: waiting for sockets...");

  // Wait for sockets to appear
  const [nextReady, terminalReady] = await Promise.all([
    waitForSocket(NEXTJS_SOCKET, HEALTH_CHECK_TIMEOUT_MS),
    waitForSocket(TERMINAL_SOCKET, HEALTH_CHECK_TIMEOUT_MS),
  ]);

  if (!nextReady) {
    logError("Health check failed: Next.js socket not ready");
    return false;
  }
  if (!terminalReady) {
    logError("Health check failed: Terminal socket not ready");
    return false;
  }

  logDeploy("Health check: sockets ready, checking HTTP...");

  // Wait for HTTP to respond
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Read local API key for authenticated request
      const keyFile = join(DATA_DIR, "rdv", ".local-key");
      const apiKey = existsSync(keyFile)
        ? readFileSync(keyFile, "utf-8").trim()
        : "";

      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const result = await httpGetOverSocket(
        NEXTJS_SOCKET,
        "/api/sessions",
        headers
      );

      if (result.statusCode === 200) {
        // Verify we got valid JSON with no errors
        try {
          const data = JSON.parse(result.body);
          if (Array.isArray(data) || (data && !data.error)) {
            logDeploy(
              `Health check: local HTTP OK (${result.statusCode})`
            );
            return await healthCheckSSR();
          }
          logError(
            `Health check: API returned error: ${JSON.stringify(data.error)}`
          );
        } catch {
          logError("Health check: invalid JSON response from /api/sessions");
        }
      } else if (result.statusCode === 401) {
        // Auth issue — the server is up but we can't authenticate.
        // This is OK for liveness, the API key may not be provisioned yet.
        logDeploy(
          `Health check: local HTTP responding (${result.statusCode}, auth pending)`
        );
        return await healthCheckSSR();
      } else {
        logDeploy(
          `Health check: got ${result.statusCode}, retrying...`
        );
      }
    } catch {
      // Connection refused or timeout — server still starting
    }

    await Bun.sleep(HEALTH_CHECK_INTERVAL_MS);
  }

  logError("Health check failed: local HTTP not responding");
  return false;
}

// SSR page probe — closes the gap where /api/* returns 200 while page routes
// 500 (remote-dev-2cd4 / the 2026-06-03 proxy-redirect incident). Runs after
// the API liveness check confirms the server is up.
async function healthCheckSSR(socketPath: string = NEXTJS_SOCKET): Promise<boolean> {
  for (const path of SSR_PROBE_PATHS) {
    const deadline = Date.now() + SSR_PROBE_TIMEOUT_MS;
    let status = -1;
    let lastErr = "";
    while (Date.now() < deadline) {
      try {
        const res = await httpGetOverSocket(socketPath, path);
        status = res.statusCode;
        if (isAcceptableSsrStatus(path, status)) break;
        if (status >= 500) {
          // A 5xx on an SSR route is a deterministic broken build — fail fast
          // rather than burn the timeout retrying a compile/runtime error.
          logError(`Health check: SSR ${path} returned ${status} (5xx) — broken build`);
          return false;
        }
        // Unexpected non-5xx (e.g. a transient 404 during warmup): retry.
      } catch (err) {
        lastErr = String(err);
      }
      await Bun.sleep(HEALTH_CHECK_INTERVAL_MS);
    }
    if (!isAcceptableSsrStatus(path, status)) {
      logError(
        `Health check: SSR ${path} not healthy (last status: ${status}${lastErr ? `, error: ${lastErr}` : ""})`,
      );
      return false;
    }
    logDeploy(`Health check: SSR ${path} OK (${status})`);
  }
  return true;
}

async function healthCheckExternal(): Promise<boolean> {
  logDeploy(`Health check: checking external URL ${EXTERNAL_URL}...`);

  const deadline = Date.now() + 30_000; // 30s for external
  while (Date.now() < deadline) {
    try {
      const keyFile = join(DATA_DIR, "rdv", ".local-key");
      const apiKey = existsSync(keyFile)
        ? readFileSync(keyFile, "utf-8").trim()
        : "";

      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${EXTERNAL_URL}/api/sessions`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        // CF Access may return a 200 HTML login page instead of JSON.
        // Check content-type to distinguish.
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          if (Array.isArray(data) || (data && !data.error)) {
            logDeploy(
              `Health check: external URL OK (${response.status})`
            );
            return true;
          }
          logError(
            `Health check: external API returned error: ${JSON.stringify(data.error)}`
          );
        } else {
          // Got a response (likely CF Access login page) — server is reachable
          logDeploy(
            `Health check: external URL reachable (${response.status}, CF Access intercepted)`
          );
          return true;
        }
      } else if (response.status === 401 || response.status === 403) {
        // CF Access blocking our request — server is reachable
        logDeploy(
          `Health check: external URL reachable (${response.status}, CF Access blocking)`
        );
        return true;
      } else {
        logDeploy(
          `Health check: external got ${response.status}, retrying...`
        );
      }
    } catch (err) {
      logDeploy(
        `Health check: external URL not reachable (${err instanceof Error ? err.message : String(err)}), retrying...`
      );
    }

    await Bun.sleep(HEALTH_CHECK_INTERVAL_MS);
  }

  logError("Health check failed: external URL not reachable");
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy orchestration
// ─────────────────────────────────────────────────────────────────────────────

// Keep the in-cluster Forgejo mirror (joyfulhouse/remote-dev) current with the
// commit we just shipped, so the homelab build-rdv-platform pipeline — which now
// clones Forgejo instead of GitHub (no GitHub PAT) — builds the same master.
// Best-effort: a mirror-push failure must NEVER affect a green deploy. SSH-key
// auth; GH_TOKEN/GITHUB_TOKEN are cleared so a GitHub credential can't hijack the
// push, and the Forgejo host key is auto-accepted on first contact.
function pushToForgejoMirror(): void {
  const url = resolveForgejoMirrorUrl();
  if (!url) {
    logDeploy("Forgejo mirror push disabled (RDV_FORGEJO_MIRROR_URL empty).");
    return;
  }
  try {
    const res = spawnSync(
      ["git", "-C", DEPLOY_SRC, "push", url, "HEAD:refs/heads/master"],
      {
        cwd: DEPLOY_SRC,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          GIT_SSH_COMMAND:
            "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10",
          GH_TOKEN: "",
          GITHUB_TOKEN: "",
        },
      },
    );
    if (res.exitCode === 0) {
      logDeploy(`Mirrored ${getGitCommit(DEPLOY_SRC)} to Forgejo (${url}).`);
    } else {
      const err = res.stderr?.toString().trim();
      logDeploy(
        `Forgejo mirror push failed (non-fatal): ${err || `exit ${res.exitCode}`}`,
      );
    }
  } catch (err) {
    logDeploy(`Forgejo mirror push errored (non-fatal): ${String(err)}`);
  }
}

// The deploy BODY. Runs UNDER an already-held deploy flock (acquired by the
// top-level runWithDeployFlock orchestrator, NOT here). Returns an exit code:
// 0 = success, non-zero = failure. The single owning `finally` in
// runWithDeployFlock releases the flock regardless of which branch returns — so
// every failure branch here just `return 1` (no inline releaseLock()/exit()).
async function deploy(): Promise<number> {
  {
    const state = readDeployState();
    const activeSlot = state?.activeSlot || "blue";
    const inactiveSlot: Slot = activeSlot === "blue" ? "green" : "blue";
    const previousCommit = state?.activeCommit || getGitCommitFull();

    const requestedCommit = process.env.DEPLOY_REQUESTED_COMMIT || getGitCommitFull();
    const startedAt = new Date().toISOString();

    // Record a terminal "failed" result for a given stage before we roll back
    // and exit. Each failure site differs only by stage + error message.
    const writeFailure = (stage: string, error: string): void =>
      writeDeployResult({
        status: "failed",
        requestedCommit,
        activeCommit: previousCommit,
        stage,
        error,
        startedAt,
        finishedAt: new Date().toISOString(),
      });

    writeDeployResult({
      status: "in_progress",
      requestedCommit,
      activeCommit: previousCommit,
      stage: "start",
      startedAt,
    });

    logDeploy(`=== Deploy started ===`);
    logDeploy(`Active slot: ${activeSlot}, building into: ${inactiveSlot}`);

    // Build into inactive slot
    if (!buildSlot(inactiveSlot)) {
      logError("Build failed, aborting deploy");
      writeFailure("build", "Build failed");
      return 1;
    }

    // The commit we actually built/shipped is DEPLOY_SRC's HEAD (origin/master),
    // NOT PROJECT_ROOT's — PROJECT_ROOT is no longer reset per deploy. Recording
    // this is what keeps state.json's activeCommit == the pushed SHA so the CI
    // poll (GET /api/deploy/status) can confirm the right commit went live.
    const newCommit = getGitCommitFull(DEPLOY_SRC);
    logDeploy(`Swapping from ${activeSlot} to ${inactiveSlot}...`);

    // Stop current servers, run migration, restart via rdv.ts.
    // We use rdv.ts instead of starting servers directly because rdv.ts
    // runs in the user's shell environment with proper locale vars (LC_ALL,
    // LANG, etc.) required for correct PTY/UTF-8 encoding in node-pty.
    stopCurrentServers();

    // Run database migration while servers are stopped
    if (!runMigration()) {
      logError("Migration failed, restarting via rdv.ts...");
      writeFailure("migration", "Migration failed");
      restartViaRdvAsync();
      await Bun.sleep(5000);
      return 1;
    }

    // Activate the freshly-built slot AFTER migration: copy it over the live
    // serving dir (PROJECT_ROOT/.next/standalone) before restart, so the new
    // code only goes live once the schema is migrated. The build now happens in
    // an isolated deploy-src worktree → slot (remote-dev-yxvy), so unlike the
    // pre-#342 in-place builds the live dir is NOT updated by buildSlot. Without
    // this copy the restart re-serves the previous build and the deploy ships
    // stale code while still reporting success (remote-dev-4vmm).
    if (!restoreSlotToLive(inactiveSlot)) {
      logError("Failed to activate built slot over live dir, rolling back...");
      writeFailure("activate", `Could not restore ${inactiveSlot} slot to live dir`);
      await rollbackTo(activeSlot);
      return 1;
    }

    // Restart servers via rdv.ts (known working server startup path)
    restartViaRdvAsync();

    // Local health check
    const localHealthy = await healthCheckLocal();
    if (!localHealthy) {
      logError("Local health check failed, rolling back...");
      writeFailure("health-local", "Local health check failed");
      stopCurrentServers();
      await rollbackTo(activeSlot);
      return 1;
    }

    // External health check
    const externalHealthy = await healthCheckExternal();
    if (!externalHealthy) {
      logError("External health check failed, rolling back...");
      writeFailure("health-external", "External health check failed");
      stopCurrentServers();
      await rollbackTo(activeSlot);
      return 1;
    }

    // Update deploy state
    writeDeployState({
      activeSlot: inactiveSlot,
      activeCommit: newCommit,
      deployedAt: new Date().toISOString(),
      previousSlot: activeSlot,
      previousCommit: previousCommit,
    });

    writeDeployResult({
      status: "success",
      requestedCommit,
      activeCommit: newCommit,
      stage: "done",
      startedAt,
      finishedAt: new Date().toISOString(),
    });

    logDeploy(
      `=== Deploy successful === (${activeSlot} -> ${inactiveSlot}, commit: ${getGitCommit(DEPLOY_SRC)})`
    );

    // Mirror the just-shipped commit to the in-cluster Forgejo (best-effort;
    // never fails the green deploy) so the homelab build pipeline clones it.
    pushToForgejoMirror();
    return 0;
  }
}

// Restore a slot's known-good build over the live serving dir before restart.
// Computes the slot/live paths from the deploy layout and delegates the copy to
// restoreStandalone (deploy-lib, unit-tested). remote-dev-j0x5.
function restoreSlotToLive(slot: Slot): boolean {
  const slotStandalone = join(BUILDS_DIR, slot, "standalone");
  const liveStandalone = join(PROJECT_ROOT, ".next", "standalone");
  const res = restoreStandalone(slotStandalone, liveStandalone);
  if (!res.ok) {
    logError(`Could not restore ${slot} slot build to live .next/standalone (${res.reason})`);
    return false;
  }
  logDeploy(`Activated ${slot} slot build -> live .next/standalone`);
  return true;
}

async function rollbackTo(slot: Slot): Promise<void> {
  // Restore the target slot's KNOWN-GOOD build over the live serving dir BEFORE
  // restarting — otherwise the restart re-serves the still-broken build a failed
  // deploy left in PROJECT_ROOT/.next/standalone (remote-dev-j0x5).
  if (!restoreSlotToLive(slot)) {
    logError(
      `CRITICAL: ${slot} slot build missing — restarting current build as a last resort (may still be broken).`,
    );
  }

  logDeploy(`Rolling back to ${slot}, restarting via rdv.ts...`);
  restartViaRdvAsync();
  await Bun.sleep(5000);

  const localHealthy = await healthCheckLocal();
  if (localHealthy) {
    logDeploy(`Rollback to ${slot} successful`);
  } else {
    logError(`CRITICAL: Rollback health check failed! Manual intervention needed.`);
  }
}

// The rollback BODY. Runs UNDER an already-held deploy flock (acquired by the
// top-level runWithDeployFlock orchestrator). Returns an exit code.
async function rollback(): Promise<number> {
  const state = readDeployState();
  if (!state) {
    logError("No deploy state found, cannot rollback");
    return 1;
  }

  logDeploy(`=== Rollback started ===`);
  logDeploy(
    `Rolling back from ${state.activeSlot} to ${state.previousSlot} (commit: ${state.previousCommit.slice(0, 7)})`
  );

  stopCurrentServers();
  await rollbackTo(state.previousSlot);

  // Swap state
  writeDeployState({
    activeSlot: state.previousSlot,
    activeCommit: state.previousCommit,
    deployedAt: new Date().toISOString(),
    previousSlot: state.activeSlot,
    previousCommit: state.activeCommit,
  });

  logDeploy(`=== Rollback complete ===`);
  return 0;
}

function showStatus(): void {
  const state = readDeployState();
  if (!state) {
    console.log("No deploy state found. Run with --init to initialize.");
    return;
  }

  console.log("\nDeploy Status");
  console.log("─".repeat(50));
  console.log(`  Active Slot:     ${state.activeSlot}`);
  console.log(`  Active Commit:   ${state.activeCommit.slice(0, 7)}`);
  console.log(`  Deployed At:     ${state.deployedAt}`);
  console.log(`  Previous Slot:   ${state.previousSlot}`);
  console.log(`  Previous Commit: ${state.previousCommit.slice(0, 7) || "(none)"}`);
  console.log(
    `  Blue Build:      ${existsSync(join(BUILDS_DIR, "blue", "standalone")) ? "exists" : "empty"}`
  );
  console.log(
    `  Green Build:     ${existsSync(join(BUILDS_DIR, "green", "standalone")) ? "exists" : "empty"}`
  );

  // deploy.lock is a PERMANENT file (never unlinked), so existence alone no longer
  // means "held" — a leftover dead-PID file persists after every deploy. Report
  // "held" ONLY when the named PID is actually ALIVE (EPERM-is-alive), mirroring
  // every other reader (status route, watchdog, the 409 route). The lock content
  // is the bare PID the flock holder writes (steady state); the legacy JSON
  // {pid,token} form is transition-only — parse both via the shared codec.
  const lockPid = existsSync(LOCK_FILE)
    ? parseLockContent(readFileSync(LOCK_FILE, "utf-8")).pid
    : null;
  if (lockPid !== null && isLockHolderAlive(lockPid)) {
    console.log(`  Lock:            held by PID ${lockPid}`);
  } else {
    console.log(`  Lock:            free`);
  }
  console.log();
}

async function init(): Promise<void> {
  ensureDirs();

  const existing = readDeployState();
  if (existing) {
    console.log("Deploy state already exists. Current state:");
    showStatus();
    return;
  }

  const commit = getGitCommitFull();

  // Copy current build into blue slot
  const srcStandalone = join(PROJECT_ROOT, ".next", "standalone");
  const blueDir = join(BUILDS_DIR, "blue", "standalone");

  if (existsSync(srcStandalone)) {
    logDeploy("Copying current build into blue slot...");
    if (existsSync(blueDir)) {
      rmSync(blueDir, { recursive: true, force: true });
    }
    mkdirSync(blueDir, { recursive: true });
    cpSync(srcStandalone, blueDir, { recursive: true });

    // Copy static assets
    const srcStatic = join(PROJECT_ROOT, ".next", "static");
    const destStatic = join(blueDir, ".next", "static");
    if (existsSync(srcStatic)) {
      cpSync(srcStatic, destStatic, { recursive: true });
    }

    // Copy public
    const srcPublic = join(PROJECT_ROOT, "public");
    const destPublic = join(blueDir, "public");
    if (existsSync(srcPublic)) {
      cpSync(srcPublic, destPublic, { recursive: true });
    }
  }

  writeDeployState({
    activeSlot: "blue",
    activeCommit: commit,
    deployedAt: new Date().toISOString(),
    previousSlot: "green",
    previousCommit: "",
  });

  logDeploy(`Deploy state initialized (blue slot, commit: ${commit.slice(0, 7)})`);
  showStatus();
}

// ─────────────────────────────────────────────────────────────────────────────
// Flock orchestration (remote-dev-v7gi flock redesign)
//
// Locking ownership lives at the TOP LEVEL (these runners), NOT inside the deploy
// / rollback bodies. A runner acquires (or, for the `--skip-lock` child, adopts)
// the flock, runs the body, and releases in a SINGLE `finally` — so a body just
// returns an exit code and never touches the lock.
// ─────────────────────────────────────────────────────────────────────────────

const EXIT_LOCK_HELD = 0; // contention is a clean no-op, NOT a failure to report.
const EXIT_FAIL = 1;

/**
 * Acquire the deploy flock and run `body` under it, releasing in a finally.
 *
 *   - FFI unavailable (FlockUnavailableError) → FAIL CLOSED: log, write a failed
 *     result, exit non-zero. NO userland fallback, NO deploy.
 *   - Lock HELD (another live deploy) → clean exit 0 with NO failed result (so we
 *     never clobber the winner's in_progress/success record).
 *   - Acquired → write our PID, run body, release.
 *
 * On the LEGACY transition (exactly one deploy): if DEPLOY_LOCK_HANDOFF is set and
 * the existing JSON lock token matches, the flock acquire OVERWRITES the JSON with
 * our plain PID. New code never creates JSON locks.
 */
async function runWithDeployFlock(
  body: (lock: FlockHandle) => Promise<number>,
): Promise<number> {
  let acquired: FlockHandle | { outcome: "held" };
  try {
    acquired = acquireDeployFlock({
      lockFile: LOCK_FILE,
      pid: process.pid,
      log: FLOCK_LOG,
      legacyHandoffToken: process.env.DEPLOY_LOCK_HANDOFF || undefined,
    });
  } catch (err) {
    if (err instanceof FlockUnavailableError) {
      // FAIL CLOSED — the OS mutex is unavailable, so we must NOT deploy.
      logError(
        `Deploy flock unavailable (${String(err)}); refusing to deploy without the OS mutex.`,
      );
      writeDeployResult({
        status: "failed",
        requestedCommit: process.env.DEPLOY_REQUESTED_COMMIT || getGitCommitFull(),
        activeCommit: readDeployState()?.activeCommit ?? null,
        stage: "lock",
        error: "deploy flock (OS mutex) unavailable",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      return EXIT_FAIL;
    }
    throw err;
  }

  if (acquired.outcome === "held") {
    // Another live deploy holds the flock. Deliberately write NO result record:
    // the winner may be deploying this same commit, and a "failed" record would
    // clobber its in_progress/success record. CI degrades to a poll timeout — the
    // safe direction.
    logDeploy("Another deploy holds the lock; exiting without action.");
    return EXIT_LOCK_HELD;
  }

  const lock = acquired;
  try {
    return await body(lock);
  } finally {
    lock.release();
  }
}

/**
 * Adopt the deploy flock the PARENT handed us via the inherited fd named by
 * DEPLOY_LOCK_FD (the `--skip-lock` child path), run `body`, release in a finally.
 * REQUIRES DEPLOY_LOCK_FD to be set — refuse otherwise (a `--skip-lock` child with
 * no inherited lock must NEVER run unlocked).
 */
async function runWithAdoptedFlock(
  body: (lock: FlockHandle) => Promise<number>,
): Promise<number> {
  const fdStr = process.env.DEPLOY_LOCK_FD;
  const fd = fdStr ? parseInt(fdStr, 10) : NaN;
  if (!Number.isInteger(fd)) {
    logError(
      "Deploy invoked with --skip-lock but DEPLOY_LOCK_FD is unset/invalid; " +
        "refusing to run unlocked.",
    );
    return EXIT_FAIL;
  }
  let lock: FlockHandle;
  try {
    lock = adoptInheritedFlock({ fd, lockFile: LOCK_FILE, pid: process.pid, log: FLOCK_LOG });
  } catch (err) {
    if (err instanceof FlockUnavailableError) {
      logError(`Deploy flock FFI unavailable in --skip-lock child (${String(err)}); refusing to run.`);
    } else if (err instanceof FlockForgedFdError) {
      // The inherited fd is NOT the real deploy.lock inode (a forged/misrouted
      // DEPLOY_LOCK_FD). Refuse — running here would deploy WITHOUT the mutex.
      logError(`Deploy flock adoption rejected (${String(err)}); refusing to run unlocked.`);
    } else {
      logError(`Deploy flock adoption failed (${String(err)}); refusing to run unlocked.`);
    }
    return EXIT_FAIL;
  }
  try {
    return await body(lock);
  } finally {
    lock.release();
  }
}

/**
 * The DEFAULT deploy orchestration, run UNDER the flock in the PROJECT_ROOT entry.
 * Bootstrap deploy-src to origin/master, then SPAWN the FRESH origin/master
 * deploy-src deploy.ts with `--skip-lock`, handing it the locked fd as fd 3. The
 * parent re-pins the PID file to the child's PID, closes its own fd WITHOUT
 * unlinking (the child owns the lock now), awaits the child, and returns its code.
 *
 * Do NOT fall back to the (possibly stale) PROJECT_ROOT orchestrator for forward
 * deploys: if deploy-src cannot be pinned or its deploy.ts/deploy-lib.ts is
 * missing, write a failed result and exit.
 */
async function runForwardDeployUnderLock(lock: FlockHandle): Promise<number> {
  const requestedCommit = process.env.DEPLOY_REQUESTED_COMMIT || getGitCommitFull();
  const startedAt = new Date().toISOString();
  const failClosed = (stage: string, error: string): number => {
    logError(error);
    writeDeployResult({
      status: "failed",
      requestedCommit,
      activeCommit: readDeployState()?.activeCommit ?? null,
      stage,
      error,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    return EXIT_FAIL;
  };

  // Pin deploy-src to origin/master (idempotent fetch + reset --hard, or first
  // create). This runs UNDER the flock, so no concurrent deploy mutates deploy-src.
  if (!ensureDeploySrcAtOrigin()) {
    return failClosed(
      "bootstrap",
      "Could not pin deploy-src to origin/master; refusing to run a stale forward deploy.",
    );
  }

  const deploySrcScript = join(DEPLOY_SRC, "scripts", "deploy.ts");
  const deploySrcLib = join(DEPLOY_SRC, "scripts", "deploy-lib.ts");
  if (!existsSync(deploySrcScript) || !existsSync(deploySrcLib)) {
    return failClosed(
      "bootstrap",
      `deploy-src is missing scripts/deploy.ts or scripts/deploy-lib.ts (${DEPLOY_SRC}); ` +
        "refusing to run a half-synced forward deploy.",
    );
  }

  // Hand the flock to the fresh deploy-src copy via fd 3. The child inherits the
  // SAME open file description, so the kernel keeps the flock held across the
  // handoff. We re-pin the PID file to the child's PID FIRST (so a reader / a
  // future acquirer sees the live deploy process), then close OUR fd WITHOUT
  // unlinking (the child owns the file now) and await the child.
  const cleanEnv: Record<string, string> = { ...process.env } as Record<string, string>;
  cleanEnv.DEPLOY_PROJECT_ROOT = PROJECT_ROOT;
  cleanEnv.DEPLOY_LOCK_FD = String(CHILD_LOCK_FD);
  // The child re-pins the PID file to its OWN pid as soon as it adopts; never pass
  // a JSON-handoff token to the fresh copy (it writes plain PIDs only).
  delete cleanEnv.DEPLOY_LOCK_HANDOFF;

  logDeploy(
    `Spawning fresh origin/master deploy-src orchestrator (--skip-lock, fd ${CHILD_LOCK_FD}): ${deploySrcScript}`,
  );

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn({
      cmd: ["bun", "run", deploySrcScript, "--skip-lock"],
      cwd: DEPLOY_SRC,
      env: cleanEnv,
      // stdio index 3 = the locked fd. ["ignore", "inherit", "inherit", fd].
      stdio: ["ignore", "inherit", "inherit", lock.fd],
    });
  } catch (err) {
    // Spawn failed before fd transfer → the parent still owns the lock; the
    // owning finally (runWithDeployFlock) releases it (unlock + close — the
    // permanent deploy.lock file is never unlinked).
    return failClosed("spawn", `Failed to spawn deploy-src orchestrator: ${String(err)}`);
  }

  const childPid = child.pid;
  if (typeof childPid === "number") {
    // Re-pin the PID file to the child so PID readers / future acquirers see the
    // live deploy process, then DETACH our ownership: close our fd WITHOUT
    // unlocking (closeKeepLock). The child holds the same flock via fd 3 and will
    // unlock + close in its own finally (deploy.lock is permanent — never
    // unlinked). closeKeepLock() also marks the handle released so
    // runWithDeployFlock's finally is a no-op (it must not LOCK_UN the flock the
    // child now relies on).
    try {
      lock.writeOwnerPid(childPid);
    } catch (err) {
      logError(`Failed to re-pin PID file to child ${childPid} (continuing): ${String(err)}`);
    }
    lock.closeKeepLock();
  }

  const code = await child.exited;
  logDeploy(`deploy-src orchestrator exited with code ${code}`);
  return code ?? EXIT_FAIL;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const skipLock = args.includes("--skip-lock");

  let exitCode = 0;
  if (args.includes("--status")) {
    // Read-only; no lock.
    showStatus();
  } else if (args.includes("--init")) {
    // State setup; no concurrent-deploy mutex needed.
    await init();
  } else if (args.includes("--rollback")) {
    // Rollback runs IN-PROCESS under the flock (no deploy-src spawn). A
    // `--skip-lock` rollback (unusual) adopts an inherited fd.
    ensureDirs();
    exitCode = skipLock
      ? await runWithAdoptedFlock(() => rollback())
      : await runWithDeployFlock(() => rollback());
  } else if (skipLock) {
    // The FRESH deploy-src child: adopt the inherited flock (fd 3) and run the
    // actual deploy body. The PARENT already bootstrapped deploy-src + holds the
    // flock; we re-pin the PID file to ourselves on adoption.
    ensureDirs();
    exitCode = await runWithAdoptedFlock(() => deploy());
  } else {
    // The DEFAULT PROJECT_ROOT entry (manual run OR webhook spawn): acquire the
    // flock, bootstrap deploy-src, and spawn the fresh origin/master orchestrator
    // with --skip-lock + fd 3.
    ensureDirs();
    exitCode = await runWithDeployFlock((lock) => runForwardDeployUnderLock(lock));
  }
  process.exit(exitCode);
}
