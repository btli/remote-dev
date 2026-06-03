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
  openSync,
  writeSync,
  closeSync,
  renameSync,
} from "fs";
import { join } from "path";
import { homedir, hostname as osHostname } from "os";
import http from "http";
import { SSR_PROBE_PATHS, isAcceptableSsrStatus, restoreStandalone } from "./deploy-lib";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = join(import.meta.dir, "..");
const DATA_DIR = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
const DEPLOY_DIR = join(DATA_DIR, "deploy");
const BUILDS_DIR = join(DATA_DIR, "builds");
const SOCKET_DIR = join(DATA_DIR, "run");
const SERVER_DIR = join(DATA_DIR, "server");
const STATE_FILE = join(DEPLOY_DIR, "state.json");
const LOCK_FILE = join(DEPLOY_DIR, "deploy.lock");
const LOG_FILE = join(DEPLOY_DIR, "deploy.log");
const RESULT_FILE = join(DEPLOY_DIR, "last-deploy.json");

const NEXTJS_SOCKET = join(SOCKET_DIR, "nextjs.sock");
const TERMINAL_SOCKET = join(SOCKET_DIR, "terminal.sock");

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
// Lock management
// ─────────────────────────────────────────────────────────────────────────────

function acquireLock(): boolean {
  // Check for stale locks first
  if (existsSync(LOCK_FILE)) {
    try {
      const lockPid = parseInt(readFileSync(LOCK_FILE, "utf-8").trim());
      if (!isNaN(lockPid)) {
        try {
          process.kill(lockPid, 0);
          // Process is alive — lock is held
          logError(`Deploy already in progress (PID: ${lockPid})`);
          return false;
        } catch {
          // Process is dead — stale lock, remove it
          logDeploy(`Removing stale lock (PID: ${lockPid} is dead)`);
          unlinkSync(LOCK_FILE);
        }
      } else {
        unlinkSync(LOCK_FILE);
      }
    } catch {
      try { unlinkSync(LOCK_FILE); } catch { /* Ignore */ }
    }
  }

  // Atomic lock acquisition using O_EXCL (kernel-level exclusive create)
  try {
    const fd = openSync(LOCK_FILE, "wx"); // O_WRONLY | O_CREAT | O_EXCL
    writeSync(fd, process.pid.toString());
    closeSync(fd);
    return true;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") {
      // Another process acquired the lock between our check and create
      logError("Deploy lock acquired by another process");
      return false;
    }
    throw err;
  }
}

function releaseLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      // Only release if we own the lock
      const lockPid = parseInt(readFileSync(LOCK_FILE, "utf-8").trim());
      if (isNaN(lockPid) || lockPid === process.pid) {
        unlinkSync(LOCK_FILE);
      }
    }
  } catch {
    // Ignore
  }
}

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

function getGitCommit(): string {
  const result = spawnSync(["git", "rev-parse", "--short", "HEAD"], {
    cwd: PROJECT_ROOT,
  });
  return result.stdout?.toString().trim() || "unknown";
}

function getGitCommitFull(): string {
  const result = spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: PROJECT_ROOT,
  });
  return result.stdout?.toString().trim() || "unknown";
}

function buildSlot(slot: Slot): boolean {
  const buildDir = join(BUILDS_DIR, slot);
  const standaloneDir = join(buildDir, "standalone");
  const startTime = Date.now();

  logDeploy(`Building into ${slot} slot...`);

  // Step 1: Sync PROJECT_ROOT to origin/master, robust against a dirty/untracked
  // working tree. A plain `git merge --ff-only` aborts the whole deploy if any
  // untracked file collides with an incoming tracked file (e.g. a stray
  // docs/*.md — see remote-dev-1oxx) or if a tracked file is dirty (e.g.
  // .beads/issues.jsonl, which bd auto-flushes). We keep the fast-forward
  // SAFETY — never silently discard divergent local commits — via an ancestry
  // check, then `git reset --hard` to force the tree to match origin/master.
  // reset --hard discards dirty tracked changes and deletes only untracked
  // files in the way of incoming tracked files; gitignored runtime data
  // (.env.local, sqlite.db, node_modules, build slots) is left untouched.
  if (!runCommand(["git", "fetch", "origin"], PROJECT_ROOT, "git fetch")) {
    return false;
  }
  // Refuse to deploy if PROJECT_ROOT/HEAD has diverged from origin/master
  // (local commits not on origin) — a hard reset would silently lose them.
  // This preserves the protection the old `--ff-only` gave us.
  // `git merge-base --is-ancestor` exits 0 when HEAD is an ancestor of
  // origin/master (fast-forwardable or already equal), 1 when it is NOT
  // (PROJECT_ROOT has diverged — local commits not on origin), and a different
  // non-zero (typically 128) on a git error such as a missing origin/master ref
  // after a bad fetch. Distinguish the two so the log isn't misleading.
  const ancestry = spawnSync(
    ["git", "merge-base", "--is-ancestor", "HEAD", "origin/master"],
    { cwd: PROJECT_ROOT, stdout: "pipe", stderr: "pipe" }
  );
  if (ancestry.exitCode === 1) {
    logError(
      "PROJECT_ROOT HEAD has diverged from origin/master (local commits not on " +
        "origin?). Refusing to hard-reset and risk losing them; resolve PROJECT_ROOT manually."
    );
    return false;
  }
  if (ancestry.exitCode !== 0) {
    logError(
      `git merge-base --is-ancestor failed (exit ${ancestry.exitCode}): ` +
        (ancestry.stderr?.toString().trim() ||
          "unknown git error (origin/master ref missing after a bad fetch?)")
    );
    return false;
  }
  if (
    !runCommand(
      ["git", "reset", "--hard", "origin/master"],
      PROJECT_ROOT,
      "git reset --hard origin/master"
    )
  ) {
    return false;
  }

  // Step 2: Install dependencies
  if (
    !runCommand(
      ["bun", "install", "--frozen-lockfile"],
      PROJECT_ROOT,
      "bun install"
    )
  ) {
    return false;
  }

  // Step 3: Build rdv CLI (soft requirement — warn and continue if cargo is unavailable)
  const cargoPath = join(homedir(), ".cargo", "bin", "cargo");
  const cargoBin = existsSync(cargoPath) ? cargoPath : "cargo";
  if (
    !runCommand(
      [cargoBin, "install", "--path", join(PROJECT_ROOT, "crates", "rdv")],
      PROJECT_ROOT,
      "cargo install rdv CLI"
    )
  ) {
    logDeploy("WARNING: rdv CLI build failed (cargo not available?), continuing without it");
  }

  // Step 4: Build Next.js
  if (!runCommand(["bun", "run", "build"], PROJECT_ROOT, "bun run build")) {
    return false;
  }

  // Step 5: Copy build output to slot directory
  logDeploy(`Copying build to ${slot} slot...`);

  // Clean previous build in this slot
  if (existsSync(standaloneDir)) {
    rmSync(standaloneDir, { recursive: true, force: true });
  }
  mkdirSync(standaloneDir, { recursive: true });

  // Copy .next/standalone
  const srcStandalone = join(PROJECT_ROOT, ".next", "standalone");
  if (!existsSync(srcStandalone)) {
    logError("No .next/standalone directory found after build");
    return false;
  }
  cpSync(srcStandalone, standaloneDir, { recursive: true });

  // Copy static assets into standalone
  const srcStatic = join(PROJECT_ROOT, ".next", "static");
  const destStatic = join(standaloneDir, ".next", "static");
  if (existsSync(srcStatic)) {
    cpSync(srcStatic, destStatic, { recursive: true });
  }

  // Copy public directory
  const srcPublic = join(PROJECT_ROOT, "public");
  const destPublic = join(standaloneDir, "public");
  if (existsSync(srcPublic)) {
    cpSync(srcPublic, destPublic, { recursive: true });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logDeploy(`Build completed in ${elapsed}s (commit: ${getGitCommit()})`);

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database migration (runs between stop and start for safety)
// ─────────────────────────────────────────────────────────────────────────────

function runMigration(): boolean {
  if (!runCommand(
    ["bun", "run", "db:push"],
    PROJECT_ROOT,
    "database migration"
  )) {
    return false;
  }

  // Backfill github_account_metadata for any OAuth accounts missing metadata
  runCommand(
    ["bun", "run", "db:migrate-github-accounts"],
    PROJECT_ROOT,
    "GitHub account metadata backfill"
  );

  // Backfill the user_email resolution index: every existing user without a
  // primary user_email row gets one (idempotent). Runs after db:push created
  // the table, so multi-email resolution works for pre-existing accounts.
  runCommand(
    ["bun", "run", "db:backfill-user-emails"],
    PROJECT_ROOT,
    "user_email index backfill"
  );

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

async function deploy(): Promise<void> {
  ensureDirs();

  if (!acquireLock()) {
    // Lost a deploy-lock race (the POST /api/deploy lock check passed, then
    // another deploy grabbed the lock first). Deliberately write NO result
    // record here: the winner may be deploying this same commit, and a "failed"
    // record would clobber its in_progress/success record (a false failure).
    // CI degrades to a poll timeout instead — the safe direction.
    process.exit(1);
  }

  try {
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
      releaseLock();
      process.exit(1);
    }

    const newCommit = getGitCommitFull();
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
      releaseLock();
      process.exit(1);
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
      releaseLock();
      process.exit(1);
    }

    // External health check
    const externalHealthy = await healthCheckExternal();
    if (!externalHealthy) {
      logError("External health check failed, rolling back...");
      writeFailure("health-external", "External health check failed");
      stopCurrentServers();
      await rollbackTo(activeSlot);
      releaseLock();
      process.exit(1);
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
      `=== Deploy successful === (${activeSlot} -> ${inactiveSlot}, commit: ${getGitCommit()})`
    );
  } finally {
    releaseLock();
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
    logError(`Rollback: could not restore ${slot} slot build (${res.reason})`);
    return false;
  }
  logDeploy(`Rollback: restored ${slot} slot build -> live .next/standalone`);
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

async function rollback(): Promise<void> {
  ensureDirs();

  const state = readDeployState();
  if (!state) {
    logError("No deploy state found, cannot rollback");
    process.exit(1);
  }

  if (!acquireLock()) {
    process.exit(1);
  }

  try {
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
  } finally {
    releaseLock();
  }
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

  const lockExists = existsSync(LOCK_FILE);
  if (lockExists) {
    const lockPid = readFileSync(LOCK_FILE, "utf-8").trim();
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
// Main
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--rollback")) {
    await rollback();
  } else if (args.includes("--status")) {
    showStatus();
  } else if (args.includes("--init")) {
    await init();
  } else {
    await deploy();
  }
}
