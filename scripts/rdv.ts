#!/usr/bin/env bun
/**
 * Remote Dev Process Manager
 *
 * Usage:
 *   bun run scripts/rdv.ts <command> [mode]
 *
 * Commands: start, stop, restart, status, doctor-supervision
 * Modes: dev (default), prod
 *
 * Examples:
 *   bun run scripts/rdv.ts start dev     # Start dev servers (ports 6001, 6002)
 *   bun run scripts/rdv.ts start prod    # Start prod (delegates to launchd)
 *   bun run scripts/rdv.ts stop          # Stop all servers
 *   bun run scripts/rdv.ts restart prod  # Restart prod (launchctl kickstart)
 *   bun run scripts/rdv.ts status        # Show running processes
 *
 * PROD SUPERVISION (remote-dev-7fsq — Spec v3). launchd (`dev.remote.app.prod`)
 * is the SOLE process owner in prod. Prod commands here DELEGATE to launchd
 * (kickstart/bootstrap/bootout) under the control lock instead of spawning or
 * killing anything directly; the actual wrapper runs only as the launchd child
 * (`start prod --launchd-child`, provenance-verified: ppid==1 +
 * XPC_SERVICE_NAME) or — with no plist installed — in job-absent foreground
 * mode under the foreground lock. The wrapper writes per-generation manifests
 * (process identity + socket dev/ino) so nothing ever kills a process or
 * unlinks a socket it cannot prove it owns. Dev mode is untouched.
 */

import { spawn, spawnSync } from "bun";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { ensureLocalApiKey } from "../src/lib/local-api-key";
import {
  PROD_LABEL,
  abandonChildSpawn,
  acquireControlLock,
  attributeAndKillGroup,
  acquireForegroundLock,
  appendGenerationStart,
  beginChildSpawn,
  captureProcId,
  captureSocketId,
  completeChildSpawn,
  consumeDeployRestartToken,
  CorruptManifestError,
  currentGenerationState,
  decideRestartProd,
  decideStartProd,
  decideStopProd,
  deployLockLive,
  doctorSupervision,
  flipCurrentGen,
  kickstartJob,
  launchdJobLoaded,
  LEGACY_PLIST_WARNING,
  bootoutJob,
  bootstrapJob,
  isPidAliveDeps,
  manifestFullyDead,
  nextGenNumber,
  pgroupOccupied,
  probeProdHealthy,
  procEntryFullyDead,
  procIdentityState,
  readAllLiveManifests,
  readCurrentGen,
  readDesiredState,
  readWatchdogState,
  realDeps,
  reclaimPriorGenerations,
  recordActuation,
  recordChildSpawnPid,
  signalPgid,
  signalPid,
  SupervisionEvidenceError,
  supervisionPaths,
  unlinkOwnedSocket,
  updateManifestPhase,
  verifyProcIdentity,
  waitForGenerationExit,
  writeDesiredState,
  writeManifest,
  FLAP_TICKS_REQUIRED,
  GRACE_SECONDS,
  type ChildSlot,
  type DelegationInput,
  type ReclaimResult,
  type GenerationManifest,
  type ProcId,
  type SupervisionDeps,
  type SupervisionPaths,
} from "./rdv-supervision";
import type { PureFlockHandle } from "./deploy-flock";

const PROJECT_ROOT = join(import.meta.dir, "..");
const DATA_DIR = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
const PID_DIR = join(DATA_DIR, "server");
const NEXT_PID_FILE = join(PID_DIR, "next.pid");
const TERMINAL_PID_FILE = join(PID_DIR, "terminal.pid");
const MODE_FILE = join(PID_DIR, "mode");
const STANDALONE_DIR = join(PROJECT_ROOT, ".next", "standalone");
const SOCKET_DIR = join(DATA_DIR, "run");
const LOGS_DIR = join(DATA_DIR, "logs");
const TERMINAL_LOG_FILE = join(LOGS_DIR, "terminal.log");
const NEXT_LOG_FILE = join(LOGS_DIR, "nextjs.log");

// Ports come from env vars so two pods on the same host can run concurrently
// for multi-instance smoke tests (`PORT=6101 TERMINAL_PORT=6102 ...`).
// Defaults match the legacy hardcoded values for single-instance dev.
const DEV_NEXT_PORT = parseInt(process.env.PORT || "6001", 10);
const DEV_TERMINAL_PORT = parseInt(process.env.TERMINAL_PORT || "6002", 10);

const CONFIG = {
  dev: {
    type: "port" as const,
    nextPort: DEV_NEXT_PORT,
    terminalPort: DEV_TERMINAL_PORT,
    nextCmd: ["bun", "run", "next", "dev", "--turbopack", "-p", String(DEV_NEXT_PORT)],
    // Local development URL - credentials auth works here
    nextAuthUrl: process.env.AUTH_URL || `http://localhost:${DEV_NEXT_PORT}`,
  },
  prod: {
    type: "socket" as const,
    nextSocket: join(SOCKET_DIR, "nextjs.sock"),
    terminalSocket: join(SOCKET_DIR, "terminal.sock"),
    nextCmd: ["node", "scripts/standalone-server.js"],
    // Production URL - accessed via Cloudflare tunnel
    nextAuthUrl: process.env.AUTH_URL || "https://dev.bryanli.net",
  },
} as const;

type Mode = keyof typeof CONFIG;
type SpawnedProcess = ReturnType<typeof spawn>;

function ensurePidDir(): void {
  if (!existsSync(PID_DIR)) {
    mkdirSync(PID_DIR, { recursive: true });
  }
}

function ensureSocketDir(): void {
  if (!existsSync(SOCKET_DIR)) {
    console.log(`Creating socket directory: ${SOCKET_DIR}`);
    try {
      mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o755 });
    } catch {
      console.error(`Failed to create socket directory. Try: sudo mkdir -p ${SOCKET_DIR} && sudo chown $(whoami) ${SOCKET_DIR}`);
      process.exit(1);
    }
  }
}

function prepareStandalone(): void {
  // Next.js standalone mode requires static files to be copied/symlinked
  const staticSrc = join(PROJECT_ROOT, ".next", "static");
  const staticDest = join(STANDALONE_DIR, ".next", "static");
  const publicSrc = join(PROJECT_ROOT, "public");
  const publicDest = join(STANDALONE_DIR, "public");

  // Create symlink for .next/static (ensure parent dir exists)
  if (existsSync(staticSrc) && !existsSync(staticDest)) {
    const staticParent = join(STANDALONE_DIR, ".next");
    if (!existsSync(staticParent)) mkdirSync(staticParent, { recursive: true });
    console.log("Linking static files for standalone mode...");
    symlinkSync(staticSrc, staticDest);
  }

  // Create symlink for public
  if (existsSync(publicSrc) && !existsSync(publicDest)) {
    console.log("Linking public files for standalone mode...");
    symlinkSync(publicSrc, publicDest);
  }

  // Symlink node_modules/.bin into standalone so spawned binaries are accessible.
  // Standalone already has a node_modules with traced deps — symlink the .bin directory only.
  const binSrc = join(PROJECT_ROOT, "node_modules", ".bin");
  const standalonNm = join(STANDALONE_DIR, "node_modules");
  const binDest = join(standalonNm, ".bin");
  if (existsSync(binSrc) && existsSync(standalonNm) && !existsSync(binDest)) {
    console.log("Linking node_modules/.bin for standalone mode...");
    symlinkSync(binSrc, binDest);
  }
}

function readPid(file: string): number | null {
  try {
    if (existsSync(file)) {
      const pid = parseInt(readFileSync(file, "utf-8").trim());
      return isNaN(pid) ? null : pid;
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return null;
}

function writePid(file: string, pid: number): void {
  writeFileSync(file, pid.toString());
}

function removePid(file: string): void {
  try {
    if (existsSync(file)) {
      unlinkSync(file);
    }
  } catch {
    // Ignore errors
  }
}

// Liveness with fail-closed polarity (mirrors isPidAliveDeps): ONLY ESRCH
// proves the process is gone. EPERM — and any unexpected kill(2) failure —
// means "cannot prove it is dead", which must never read as dead.
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException | undefined)?.code !== "ESRCH";
  }
}

function getProcessOnPort(port: number): number | null {
  const result = spawnSync(["lsof", "-ti", `:${port}`]);
  if (result.stdout) {
    const output = result.stdout.toString().trim();
    if (output) {
      const pid = parseInt(output.split("\n")[0]);
      return isNaN(pid) ? null : pid;
    }
  }
  return null;
}

function killProcessOnPort(port: number): boolean {
  const pid = getProcessOnPort(port);
  if (pid) {
    console.log(`Killing process on port ${port} (PID: ${pid})...`);
    try {
      // Group-kill: if the listener is one of our (now-detached) servers,
      // its pgid equals its pid and signalling `-pid` cleans up the whole
      // tsx/node tree. For non-detached third-party processes, the pgid
      // is typically the listener's own pid too (daemons run setsid), so
      // this is still correct.
      killProcessGroup(pid, "SIGTERM");

      let attempts = 0;
      while (getProcessOnPort(port) && attempts < 50) {
        spawnSync(["sleep", "0.1"]);
        attempts++;
      }

      const remainingPid = getProcessOnPort(port);
      if (remainingPid) {
        console.log(`Force killing process on port ${port}...`);
        killProcessGroup(remainingPid, "SIGKILL");
        attempts = 0;
        while (getProcessOnPort(port) && attempts < 20) {
          spawnSync(["sleep", "0.1"]);
          attempts++;
        }
      }

      return true;
    } catch (err) {
      console.error(`Failed to kill process on port ${port}:`, err);
      return false;
    }
  }
  return false;
}

function waitForPortFree(port: number, timeoutMs: number = 5000): boolean {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!getProcessOnPort(port)) {
      return true;
    }
    spawnSync(["sleep", "0.1"]);
  }
  return false;
}

function getRunningMode(): Mode | null {
  try {
    if (existsSync(MODE_FILE)) {
      const mode = readFileSync(MODE_FILE, "utf-8").trim();
      if (mode === "dev" || mode === "prod") {
        return mode;
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

function saveMode(mode: Mode): void {
  writeFileSync(MODE_FILE, mode);
}

function clearMode(): void {
  removePid(MODE_FILE);
}

// Kill an entire process group by negative PID. The servers are spawned
// `detached: true` (own session/process group, pgid == leader pid), so
// signalling `-pid` reaches every descendant — including the inner tsx +
// node processes that would otherwise be re-parented to init and leak.
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

function stopProcess(pidFile: string, name: string): boolean {
  const pid = readPid(pidFile);
  if (pid && isProcessRunning(pid)) {
    console.log(`Stopping ${name} (PID: ${pid})...`);
    try {
      killProcessGroup(pid, "SIGTERM");

      let attempts = 0;
      while (isProcessRunning(pid) && attempts < 50) {
        spawnSync(["sleep", "0.1"]);
        attempts++;
      }

      if (isProcessRunning(pid)) {
        console.log(`Force killing ${name}...`);
        killProcessGroup(pid, "SIGKILL");
      }

      removePid(pidFile);
      return true;
    } catch (err) {
      console.error(`Failed to stop ${name}:`, err);
      removePid(pidFile);
      return false;
    }
  } else if (pid) {
    console.log(`${name} not running (stale PID file)`);
    removePid(pidFile);
  }
  return false;
}

// Resolve the short git commit for the startup banner. Cheap and best-effort:
// a failed/absent git just yields "unknown" and never blocks startup.
function getShortCommit(): string {
  try {
    const result = spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: PROJECT_ROOT });
    const out = result.stdout?.toString().trim();
    return out || "unknown";
  } catch {
    return "unknown";
  }
}

// Open a per-server log file (append mode) and write a one-line banner that
// delimits this restart. Returns the fd to be handed to bun's spawn as
// stdout/stderr. The data-dir logs/ directory is created if missing.
//
// This is the key diagnosis enabler: in prod the child's stdout/stderr would
// otherwise chain up to a deploy.ts that /api/deploy spawned with
// stdio:"ignore", so a terminal-server crash before the structured logger
// flushes went to /dev/null. Redirecting to a real file makes failed-deploy
// crash output recoverable.
function openServerLog(name: string, logFile: string): number {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
  const fd = openSync(logFile, "a");
  const banner = `\n===== ${name} starting ${new Date().toISOString()} (commit ${getShortCommit()}) =====\n`;
  appendFileSync(fd, banner);
  return fd;
}

async function startServer(
  name: string,
  cmd: string[],
  env: Record<string, string>,
  pidFile: string,
  logFile?: string,
  /**
   * Invoked with the child's pid the INSTANT spawn() returns, before this
   * function does anything else (fd close, pid file, logging) [F4]. The prod
   * wrapper uses it to persist pid+pgid into the generation manifest so no
   * window exists in which a live child is absent from every manifest.
   */
  onSpawned?: (pid: number) => void,
): Promise<SpawnedProcess | null> {
  console.log(`Starting ${name}...`);

  // In prod mode (logFile provided) redirect the child's stdout+stderr to an
  // append-only log file. In dev mode (no logFile) keep "inherit" so
  // `bun run dev` shows server output in the terminal. If the log file can't
  // be opened (e.g. unwritable logs dir), fall back to "inherit" rather than
  // aborting an otherwise-healthy start — losing the captured log is far less
  // harmful than failing the deploy restart.
  let stdio: number | "inherit" = "inherit";
  if (logFile) {
    try {
      stdio = openServerLog(name, logFile);
      console.log(`  ${name} stdout/stderr → ${logFile}`);
    } catch (err) {
      console.error(`  ${name}: could not open log file ${logFile}, falling back to inherit:`, err);
      stdio = "inherit";
    }
  }

  // detached: true makes the child the leader of a new session/process
  // group (POSIX setsid). This lets stop paths target the whole tree via
  // `kill -pgid` — without it, SIGTERM only hits the outer `bun run tsx`
  // wrapper and the actual server (the grandchild) survives, leaking on
  // every deploy.
  const proc = spawn({
    cmd,
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    stdout: stdio,
    stderr: stdio,
    detached: true,
  });

  // FIRST thing after spawn(2) returns — before the fd close, the pid file or
  // any logging — hand the pid to the caller so it can be persisted [F4].
  if (proc.pid && onSpawned) {
    onSpawned(proc.pid);
  }

  // The child dup'd the log fd during spawn, so close our copy in the parent
  // to avoid leaking it. Only close an fd we actually opened (a number) — not
  // the "inherit" sentinel.
  if (typeof stdio === "number") {
    try {
      closeSync(stdio);
    } catch {
      // ignore — fd may already be closed
    }
  }

  if (proc.pid) {
    writePid(pidFile, proc.pid);
    console.log(`${name} started (PID: ${proc.pid})`);
    return proc;
  }

  console.error(`Failed to start ${name}`);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev mode (unchanged behavior)
// ─────────────────────────────────────────────────────────────────────────────

async function startDev(): Promise<void> {
  ensurePidDir();
  const config = CONFIG.dev;

  // Dev mode: check if ports are in use
  const nextPortPid = getProcessOnPort(config.nextPort);
  const terminalPortPid = getProcessOnPort(config.terminalPort);

  if (nextPortPid || terminalPortPid) {
    console.error(`\nPorts already in use:`);
    if (nextPortPid) {
      console.error(`  Port ${config.nextPort}: PID ${nextPortPid}`);
    }
    if (terminalPortPid) {
      console.error(`  Port ${config.terminalPort}: PID ${terminalPortPid}`);
    }
    console.error("\nRun 'bun run rdv:stop' first or 'bun run rdv restart' to restart");
    process.exit(1);
  }

  console.log(`\nStarting Remote Dev in DEV mode`);
  console.log(`  Next.js:  http://localhost:${config.nextPort}`);
  console.log(`  Terminal: ws://localhost:${config.terminalPort}`);
  console.log(`  Auth URL: ${config.nextAuthUrl}\n`);

  // Start terminal server first
  const terminalProc = await startServer(
    "Terminal Server",
    ["bun", "run", "tsx", "src/server/index.ts"],
    { TERMINAL_PORT: config.terminalPort.toString() },
    TERMINAL_PID_FILE
  );

  console.log("Waiting for terminal server to initialize...");
  await Bun.sleep(1500);

  // Start Next.js with correct NEXTAUTH_URL for local dev
  const nextProc = await startServer(
    "Next.js",
    [...config.nextCmd],
    {
      PORT: config.nextPort.toString(),
      NEXT_PUBLIC_TERMINAL_PORT: config.terminalPort.toString(),
      NEXTAUTH_URL: config.nextAuthUrl,
      AUTH_URL: config.nextAuthUrl, // NextAuth v5 also checks AUTH_URL
    },
    NEXT_PID_FILE
  );

  await waitForDevExit(terminalProc, nextProc);
}

async function waitForDevExit(
  terminalProc: SpawnedProcess | null,
  nextProc: SpawnedProcess | null
): Promise<void> {
  saveMode("dev");

  // Ensure local API key exists for rdv CLI access
  try {
    await ensureLocalApiKey();
  } catch (err) {
    console.warn("Warning: could not provision local API key:", err);
  }

  console.log(`\nRemote Dev started in DEV mode`);
  console.log("Press Ctrl+C to stop all servers\n");

  let shuttingDown = false;
  const shutdown = (reason: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n\n${reason}, shutting down...`);
    stopDev();
    process.exit(exitCode);
  };

  process.on("SIGINT", () => shutdown("Received SIGINT", 0));
  process.on("SIGTERM", () => shutdown("Received SIGTERM", 0));

  const exitPromises: Promise<{ name: string; code: number | null }>[] = [];
  if (terminalProc) {
    exitPromises.push(terminalProc.exited.then((code) => ({
      name: "Terminal Server",
      code,
    })));
  }
  if (nextProc) {
    exitPromises.push(nextProc.exited.then((code) => ({
      name: "Next.js",
      code,
    })));
  }

  if (exitPromises.length === 0) {
    shutdown("No servers started", 1);
    return;
  }

  const { name, code } = await Promise.race(exitPromises);
  shutdown(`${name} exited (code: ${code ?? "unknown"})`, code ?? 1);
}

function stopDev(): void {
  console.log("\nStopping Remote Dev (dev)...\n");

  // Stop by PID file first
  let stoppedNext = stopProcess(NEXT_PID_FILE, "Next.js");
  let stoppedTerminal = stopProcess(TERMINAL_PID_FILE, "Terminal Server");

  const devConfig = CONFIG.dev;
  if (killProcessOnPort(devConfig.nextPort)) stoppedNext = true;
  if (killProcessOnPort(devConfig.terminalPort)) stoppedTerminal = true;

  console.log("Verifying ports are released...");
  waitForPortFree(devConfig.nextPort, 3000);
  waitForPortFree(devConfig.terminalPort, 3000);

  if (!stoppedNext && !stoppedTerminal) {
    console.log("No servers were running");
  } else {
    console.log("\nAll servers stopped");
  }

  clearMode();
}

// ─────────────────────────────────────────────────────────────────────────────
// Prod mode — §3.2 delegation + §3.3 wrapper (remote-dev-7fsq)
// ─────────────────────────────────────────────────────────────────────────────

/** Print the fail-closed state + remediation and exit non-zero [F9]. */
function failClosed(reason: string): never {
  console.error(`\nFAIL-CLOSED: ${reason}`);
  process.exit(1);
}

/**
 * Build the delegation-decision input. A CORRUPT desired-state file [R5]:
 *   - "tolerate": commands that atomically REWRITE the file (`start prod`,
 *     `stop`) treat it as unset — the rewrite is the repair.
 *   - "fail": commands that GATE on it (`restart prod`'s intentional-stop
 *     refusal) must not guess — fail closed with remediation.
 */
function delegationInput(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  launchdChildFlag: boolean,
  corruptDesiredPolicy: "tolerate" | "fail",
  /**
   * Only `start prod` can use the deploy's foreground authorization, and the
   * token is CONSUMED when it matches — so it is checked on that command
   * alone, and only on the branch that can act on it. A `stop`/`restart` (or a
   * job-loaded start) that burned the token would strand the deploy's own
   * restart. The env var is inherited by every descendant of the deploy's
   * child, so "some process happens to carry it" must never be enough.
   */
  intent: "start" | "other" = "other",
): DelegationInput {
  const ds = readDesiredState(deps, paths);
  let desiredState: DelegationInput["desiredState"] = null;
  if (ds === "corrupt") {
    if (corruptDesiredPolicy === "fail") {
      failClosed(
        "desired-state.json is CORRUPT — refusing to act on unknown intent [R5]. " +
          "Repair with `rdv start prod` (re-enable) or `rdv stop` (intentional stop).",
      );
    }
    // tolerated: the command will rewrite the file atomically.
  } else {
    desiredState = ds?.state ?? null;
  }
  const jobLoaded = launchdJobLoaded(deps, PROD_LABEL);
  const plistInstalled = existsSync(paths.prodPlist);
  const lockLive = deployLockLive(deps, paths);
  // The deploy's own restart channel [F11]: deploy.ts mints a random
  // single-use token into a 0600 file and hands it to the child it spawns.
  // Presenting the matching token consumes it, so the authorization cannot be
  // replayed and an external `rdv start prod` (which was never given a token)
  // is refused mid-deploy. Same-uid forgeability is discussed at the token
  // helpers in rdv-supervision.ts — this closes ACCIDENTAL bypass, which is
  // the failure that actually happens.
  const foregroundBranch = intent === "start" && jobLoaded === false && !plistInstalled && lockLive;
  const foregroundDeployAuthorized = foregroundBranch
    ? consumeDeployRestartToken(deps, paths, process.env.RDV_DEPLOY_RESTART_TOKEN)
    : false;
  return {
    launchdChildFlag,
    ppid: process.ppid,
    xpcServiceName: process.env.XPC_SERVICE_NAME,
    label: PROD_LABEL,
    jobLoaded,
    plistInstalled,
    desiredState,
    deployLockLive: lockLive,
    foregroundDeployAuthorized,
  };
}

/** Poll the local origin probes until healthy or the budget runs out. */
async function pollHealthyOrFail(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  timeoutMs: number,
): Promise<void> {
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    if (probeProdHealthy(deps, paths)) {
      console.log("Prod stack is healthy.");
      return;
    }
    if (deps.now() >= deadline) break;
    await deps.sleep(3000);
  }
  failClosed(
    `prod did not become healthy within ${Math.round(timeoutMs / 1000)}s. ` +
      `Check ${LOGS_DIR}/nextjs.log + ${LOGS_DIR}/terminal.log and \`rdv doctor-supervision\`.`,
  );
}

async function startProd(launchdChildFlag: boolean): Promise<void> {
  const deps = realDeps();
  const paths = supervisionPaths(process.env);
  // start prod REWRITES desired-state, so a corrupt file is tolerated (the
  // atomic rewrite is the repair) [R5].
  const input = delegationInput(deps, paths, launchdChildFlag, "tolerate", "start");
  const decision = decideStartProd(input);

  switch (decision.action) {
    case "real-start-launchd": {
      // Provenance-verified launchd child (§3.3): the wrapper holds NEITHER
      // lock — launchd serializes its own instances [F1]. It must NOT touch
      // desired-state either (a KeepAlive respawn racing an intentional stop
      // would otherwise overwrite desired=stopped).
      if (decision.legacyPlist) {
        // Not an error: provenance proved launchd started us, so supervision
        // works. Surface the upgrade so the host does not stay on the old
        // plist unnoticed.
        console.warn(`\nWARNING: ${LEGACY_PLIST_WARNING}`);
      }
      await runProdWrapper(deps, paths, null, undefined, decision.legacyPlist);
      return;
    }
    case "delegate-kickstart": {
      const lock = await acquireControlLock(deps, paths);
      if (!lock) failClosed("control lock busy — another supervision transaction is in flight; retry shortly.");
      try {
        // No launchd actuation while a live deploy holds custody [F11, R8].
        // (The deploy's own restart path never comes through here — its
        // custody object calls launchctl directly, and its job-absent path is
        // the foreground wrapper below.)
        if (deployLockLive(deps, paths)) {
          failClosed("a live deploy holds deploy.lock; refusing to actuate launchd mid-deploy. Retry after it completes.");
        }
        writeDesiredState(deps, paths, "running");
        if (probeProdHealthy(deps, paths)) {
          // Idempotent: NO kickstart -k on a healthy stack [F10].
          console.log(`Prod already running healthily under launchd (${PROD_LABEL}); nothing to do.`);
          return;
        }
        console.log(`Prod job loaded but unhealthy — launchctl kickstart -k ${PROD_LABEL}...`);
        if (!kickstartJob(deps, PROD_LABEL)) {
          failClosed(`launchctl kickstart -k ${PROD_LABEL} failed. Inspect \`launchctl print gui/$(id -u)/${PROD_LABEL}\`.`);
        }
        // Actuation succeeded: ledger + escalation math + grace stamp [F17].
        recordActuation(deps, paths, "rdv", "start-kickstart");
        await pollHealthyOrFail(deps, paths, 90_000);
      } finally {
        lock.release();
      }
      return;
    }
    case "delegate-bootstrap": {
      const lock = await acquireControlLock(deps, paths);
      if (!lock) failClosed("control lock busy — another supervision transaction is in flight; retry shortly.");
      try {
        if (deployLockLive(deps, paths)) {
          failClosed("a live deploy holds deploy.lock; refusing to actuate launchd mid-deploy. Retry after it completes.");
        }
        writeDesiredState(deps, paths, "running");
        console.log(`Bootstrapping ${PROD_LABEL} (plist installed, job not loaded)...`);
        // bootstrap STARTS the job (KeepAlive ⇒ RunAtLoad); no follow-up
        // kickstart [F10].
        if (!bootstrapJob(deps, paths.prodPlist)) {
          failClosed(`launchctl bootstrap ${paths.prodPlist} failed. Inspect launchctl output and the plist.`);
        }
        recordActuation(deps, paths, "rdv", "start-bootstrap");
        await pollHealthyOrFail(deps, paths, 90_000);
      } finally {
        lock.release();
      }
      return;
    }
    case "foreground-start": {
      // No plist installed: job-absent foreground mode under the foreground
      // lock (held for the wrapper's lifetime). The decision table already
      // gated this on the deploy lock [F11] — only the live deploy's own
      // restart (RDV_DEPLOY_PARENT_PID matching the lock holder) reaches here
      // mid-deploy.
      const fg = await acquireForegroundLock(deps, paths);
      if (!fg) {
        failClosed("foreground lock is held — another foreground prod wrapper is already running.");
      }
      const owner = captureProcId(deps, process.pid);
      writeDesiredState(deps, paths, "running", owner ? { pid: owner.pid, startTimeNs: owner.startTimeNs } : undefined);
      // The actuation is recorded INSIDE the wrapper, after the generation
      // actually publishes — never before the start has succeeded [F17].
      await runProdWrapper(deps, paths, fg, "foreground-start");
      return;
    }
    case "fail-closed":
      failClosed(decision.reason);
  }
}

async function restartProd(): Promise<void> {
  const deps = realDeps();
  const paths = supervisionPaths(process.env);
  // restart GATES on desired-state (the intentional-stop refusal), so a
  // corrupt file fails closed [R5].
  const input = delegationInput(deps, paths, false, "fail");
  const decision = decideRestartProd(input);

  switch (decision.action) {
    case "delegate-kickstart": {
      const lock = await acquireControlLock(deps, paths);
      if (!lock) failClosed("control lock busy — another supervision transaction is in flight; retry shortly.");
      try {
        // Re-check the deploy lock UNDER the control lock (a deploy may have
        // started between the decision and here) [F11].
        if (deployLockLive(deps, paths)) {
          failClosed("a live deploy holds deploy.lock; refusing to restart mid-deploy.");
        }
        writeDesiredState(deps, paths, "running");
        console.log(`launchctl kickstart -k ${PROD_LABEL}...`);
        if (!kickstartJob(deps, PROD_LABEL)) {
          failClosed(`launchctl kickstart -k ${PROD_LABEL} failed. Inspect \`launchctl print gui/$(id -u)/${PROD_LABEL}\`.`);
        }
        recordActuation(deps, paths, "rdv", "restart-kickstart");
        await pollHealthyOrFail(deps, paths, 90_000);
      } finally {
        lock.release();
      }
      return;
    }
    case "refuse-deploy-in-progress":
      failClosed("a live deploy holds deploy.lock; refusing to restart mid-deploy.");
      return;
    case "refuse-desired-stopped":
      failClosed(
        `${PROD_LABEL} is intentionally stopped (desired state = stopped). ` +
          "`rdv start prod` is the explicit re-enable [R15].",
      );
      return;
    case "foreground-restart": {
      // Job-absent foreground mode: signal the foreground owner's manifest
      // PGIDs, wait for the foreground lock to free (bounded), then start a
      // fresh foreground wrapper (which holds the reacquired lock) [R15].
      const lock = await acquireControlLock(deps, paths);
      if (!lock) failClosed("control lock busy — another supervision transaction is in flight; retry shortly.");
      let fg: PureFlockHandle | null = null;
      try {
        // ALL live manifests count — a starting (unpublished) wrapper must be
        // signalled too.
        const { manifests, corruptGens } = readAllLiveManifests(deps, paths);
        if (corruptGens.length > 0) {
          failClosed(
            `generation manifest(s) ${corruptGens.join(", ")} are corrupt — ` +
              "run `rdv doctor-supervision --force-reclaim` first.",
          );
        }
        // LEADER PID ONLY — never the wrapper's process GROUP. A foreground
        // wrapper started from an interactive shell shares that shell's
        // pgroup, so `kill(-pgid)` would take down the operator's shell, this
        // very restart command, and any unrelated job in it. The wrapper's own
        // SIGTERM handler stops its (detached) children.
        for (const m of manifests) {
          if (verifyProcIdentity(deps, m.wrapper)) {
            console.log(`Signalling foreground wrapper of generation ${m.gen} (pid ${m.wrapper.pid})...`);
            signalPid(deps, m.wrapper.pid, "SIGTERM");
          }
        }
        const deadline = deps.now() + 30_000;
        while (deps.now() < deadline) {
          fg = await acquireForegroundLock(deps, paths);
          if (fg) break;
          await deps.sleep(500);
        }
        if (!fg) {
          failClosed("foreground lock did not free within 30s; the previous wrapper is still shutting down.");
        }
      } finally {
        lock.release();
      }
      const owner = captureProcId(deps, process.pid);
      writeDesiredState(deps, paths, "running", owner ? { pid: owner.pid, startTimeNs: owner.startTimeNs } : undefined);
      // Recorded inside the wrapper after the generation publishes [F17].
      await runProdWrapper(deps, paths, fg, "foreground-restart");
      return;
    }
    case "fail-closed":
      failClosed(decision.reason);
  }
}

async function stopProd(): Promise<void> {
  const deps = realDeps();
  const paths = supervisionPaths(process.env);
  // stop REWRITES desired-state (to stopped), so a corrupt file is tolerated.
  const input = delegationInput(deps, paths, false, "tolerate");
  const decision = decideStopProd(input);

  switch (decision.action) {
    case "bootout": {
      const lock = await acquireControlLock(deps, paths);
      if (!lock) failClosed("control lock busy — another supervision transaction is in flight; retry shortly.");
      try {
        // No launchd actuation while a live deploy holds custody [F11, R8].
        if (deployLockLive(deps, paths)) {
          failClosed("a live deploy holds deploy.lock; refusing to stop mid-deploy. Retry after it completes.");
        }
        // Generation evidence must be VERIFIABLE before anything destructive:
        // with a dangling pointer or ANY corrupt manifest we cannot confirm
        // the exit afterwards [R3].
        const genState = currentGenerationState(deps, paths);
        const preCorrupt = readAllLiveManifests(deps, paths).corruptGens;
        if (genState.state === "unverifiable" || preCorrupt.length > 0) {
          failClosed(
            `generation evidence is missing/corrupt (gens ${preCorrupt.join(", ") || genState.gen}) — ` +
              "cannot verify a stop. Run `rdv doctor-supervision --force-reclaim` first.",
          );
        }
        // desired=stopped FIRST so a KeepAlive race or watchdog tick can't
        // undo the intentional stop [R5]. Captured beforehand so a FAILED
        // bootout restores the prior intent instead of suppressing watchdog
        // recovery of a still-running job.
        const prevDesired = readDesiredState(deps, paths);
        writeDesiredState(deps, paths, "stopped");
        console.log(`launchctl bootout ${PROD_LABEL}...`);
        if (!bootoutJob(deps, PROD_LABEL)) {
          if (prevDesired !== null && prevDesired !== "corrupt") {
            writeDesiredState(deps, paths, prevDesired.state, prevDesired.owner);
          } else {
            // Unset/corrupt prior intent: the job is still running, so
            // "running" is the truthful state to leave behind.
            writeDesiredState(deps, paths, "running");
          }
          failClosed(`launchctl bootout ${PROD_LABEL} failed — the job may still be running (desired state restored).`);
        }
        const outcome = await waitForGenerationExit(deps, paths, 40_000);
        if (outcome === "timeout") {
          failClosed(
            "generation processes still verified-alive 40s after bootout. " +
              "Inspect with `rdv doctor-supervision` before retrying.",
          );
        }
        if (outcome === "unverifiable") {
          failClosed("generation manifest became unverifiable during stop — run `rdv doctor-supervision --force-reclaim`.");
        }
        console.log("Prod generation exited.");
      } finally {
        lock.release();
      }
      return;
    }
    case "foreground-stop": {
      const lock = await acquireControlLock(deps, paths);
      if (!lock) failClosed("control lock busy — another supervision transaction is in flight; retry shortly.");
      try {
        if (deployLockLive(deps, paths)) {
          failClosed("a live deploy holds deploy.lock; refusing to stop mid-deploy. Retry after it completes.");
        }
        // Captured BEFORE the intent write so a stop that fails PART-WAY —
        // after signalling some processes — can put the prior intent back.
        // Leaving desired=stopped behind a half-completed stop would gate the
        // watchdog out of recovering the wreckage.
        const prevDesired = readDesiredState(deps, paths);
        const restorePrevDesired = (): void => {
          if (prevDesired !== null && prevDesired !== "corrupt") {
            writeDesiredState(deps, paths, prevDesired.state, prevDesired.owner);
          } else {
            writeDesiredState(deps, paths, "running");
          }
        };
        writeDesiredState(deps, paths, "stopped");
        // ALL live manifests count — an unpublished `starting` generation is
        // just as real as the pointed one and must be stopped too.
        const { manifests, corruptGens } = readAllLiveManifests(deps, paths);
        if (corruptGens.length > 0) {
          failClosed(
            `generation manifest(s) ${corruptGens.join(", ")} are corrupt — ` +
              "run `rdv doctor-supervision --force-reclaim`.",
          );
        }
        // Quad-state, NOT a boolean [R13]: a wrapper whose identity cannot be
        // read (sysctl failure) is neither "ours to signal" nor "gone".
        // Excluding it silently and reporting "No running prod generation" —
        // exit 0 — while the stack is still live is the fail-OPEN this closes.
        const unverifiable = manifests.filter(
          (m) => procIdentityState(deps, m.wrapper) === "identity-unavailable",
        );
        if (unverifiable.length > 0) {
          restorePrevDesired();
          failClosed(
            `generation(s) ${unverifiable.map((m) => m.gen).join(", ")} have a LIVE wrapper whose identity ` +
              "cannot be verified (sysctl kern.proc.pid failed) — refusing to signal it and refusing to " +
              "report a stop that did not happen. The prior desired state has been restored so the " +
              "watchdog can still recover this LIVE stack; once identity is readable re-run `rdv stop`, " +
              "or inspect with `rdv doctor-supervision`.",
          );
        }
        // Anything not verifiably ALL-dead still needs stopping — including a
        // generation whose wrapper already died but whose children live on.
        const liveGens = manifests.filter((m) => !manifestFullyDead(deps, m));
        if (liveGens.length === 0) {
          console.log("No running prod generation (every manifest is verifiably dead).");
          return;
        }
        for (const m of liveGens) {
          if (verifyProcIdentity(deps, m.wrapper)) {
            // LEADER PID ONLY — the wrapper's pgroup may be the invoking
            // shell's; its own shutdown handler stops the children.
            console.log(`Stopping foreground wrapper of generation ${m.gen} (pid ${m.wrapper.pid})...`);
            signalPid(deps, m.wrapper.pid, "SIGTERM");
            continue;
          }
          // Wrapper already gone: signal the children directly. They are
          // spawned detached, so their recorded PGID is exactly their own
          // tree and group-signalling them is safe.
          for (const slot of ["next", "terminal"] as const) {
            const child = m[slot];
            if (!child) continue;
            if (verifyProcIdentity(deps, child)) {
              console.log(
                `Generation ${m.gen}: wrapper gone, stopping orphaned child pid ${child.pid} (pgid ${child.pgid})...`,
              );
              signalPgid(deps, child.pgid, "SIGTERM");
              continue;
            }
            // The recorded child LEADER is dead but its group still has
            // members — the real server surviving a dead `bun run tsx`. It
            // cannot be identity-verified, so it is killed only after positive
            // attribution (bounded start-time window + recorded spawn
            // command); an unattributable group is never signalled.
            if (procIdentityState(deps, child) === "dead" && pgroupOccupied(deps, child.pgid)) {
              const outcome = await attributeAndKillGroup(deps, {
                pgid: child.pgid,
                startedAtMs: m.startedAt,
                endedAtMs: m.stoppingAt ?? null,
                expectedArgv: m.commands?.[slot] ?? null,
                label: `gen ${m.gen} child ${slot} ${child.pid}`,
              });
              console.log(`Generation ${m.gen}: ${outcome.detail}`);
              // `attributed` only says whether we were ALLOWED to signal; a
              // positively-identified group that SURVIVES SIGKILL is just as
              // incomplete a stop. What matters for desired-state is the same
              // question in both cases: are these processes proven dead? If
              // not, the prior intent goes back so the watchdog is not gated
              // out of recovering a stack that is still alive.
              if (!outcome.attributed || pgroupOccupied(deps, child.pgid)) {
                restorePrevDesired();
                failClosed(
                  `${outcome.detail}\n\nThe stop is INCOMPLETE (those processes are not proven dead) and ` +
                    "the prior desired state has been restored so the watchdog can still recover. Inspect " +
                    "the pids above, stop them by hand, or run " +
                    "`bun run scripts/rdv.ts doctor-supervision --force-reclaim` to retire the generation " +
                    "with explicit consent (it refuses while a socket still has a live holder).",
                );
              }
            }
          }
        }
        const outcome = await waitForGenerationExit(deps, paths, 40_000);
        // desired=stopped may stand ONLY on a verified-complete stop. Every
        // other ending leaves processes that are not proven dead, and the
        // watchdog must stay armed for them.
        if (outcome === "timeout") {
          restorePrevDesired();
          failClosed(
            "generation processes still verifiably present 40s after SIGTERM (prior desired state " +
              "restored so the watchdog can recover). Inspect with `rdv doctor-supervision` before retrying.",
          );
        }
        if (outcome === "unverifiable") {
          restorePrevDesired();
          failClosed(
            "generation evidence became unverifiable during the stop (prior desired state restored) — " +
              "run `rdv doctor-supervision --force-reclaim`.",
          );
        }
        console.log("Prod generation exited.");
      } finally {
        lock.release();
      }
      return;
    }
    case "fail-closed":
      failClosed(decision.reason);
  }
}

/**
 * A child was spawned but its identity could NOT be captured [F4]. It can
 * never be identity-verified later, so it must not be left running: kill it by
 * the pid we recorded at spawn AND by its process group (children are
 * detached, so pgid == pid and the group is exactly its own tree). Only once
 * it is verifiably gone is the placeholder dropped; otherwise the placeholder
 * stays so the next reclaim (or an operator force-reclaim) still sees it.
 */
async function killUnidentifiedChild(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  manifest: GenerationManifest,
  child: ChildSlot,
  pid: number,
): Promise<void> {
  console.error(`Killing ${child} child pid ${pid}: identity capture failed, it could never be verified later.`);
  const gone = (): boolean => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException | undefined)?.code !== "ESRCH") return false;
    }
    // pgid == pid for a detached child; the group must be empty too (a
    // grandchild can outlive the leader and still hold the socket).
    try {
      process.kill(-pid, 0);
      return false;
    } catch (err) {
      return (err as NodeJS.ErrnoException | undefined)?.code === "ESRCH";
    }
  };
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    if (gone()) break;
    signalPid(deps, pid, signal);
    signalPgid(deps, pid, signal);
    const deadline = deps.now() + (signal === "SIGTERM" ? 5_000 : 2_000);
    while (deps.now() < deadline && !gone()) {
      await deps.sleep(200);
    }
  }
  if (gone()) {
    abandonChildSpawn(deps, paths, manifest, child);
  } else {
    console.error(
      `${child} child pid ${pid} survived SIGKILL — leaving its spawn record in the manifest so the ` +
        "next reclaim can attribute it (its socket path stays protected from the orphan sweep).",
    );
  }
}

/** Bounded wait for a socket path to appear after spawning a child. */
async function waitForSocketPath(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await Bun.sleep(250);
  }
  return existsSync(path);
}

/**
 * The §3.3 wrapper: the ONLY code path that spawns the prod servers. Runs as
 * the provenance-verified launchd child (fgLock === null) or in job-absent
 * foreground mode (fgLock held for the wrapper's lifetime).
 *
 * Duties: pre-spawn reclaim (identity-verified kills + dev/ino socket
 * cleanup), immutable generation manifest + atomic current-generation pointer
 * flip (only after both children + sockets are recorded), generation-ledger
 * append (KeepAlive crash loops feed escalation [R12] but never stamp
 * last-restart), and concurrent PGID shutdown of both children [F8] with
 * dev/ino-verified socket unlinks [R2].
 */
async function runProdWrapper(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  fgLock: PureFlockHandle | null,
  foregroundActuationReason?: string,
  /** launchd started us from a pre-marker plist — surfaced in the banner. */
  legacyPlist = false,
): Promise<void> {
  ensurePidDir();
  ensureSocketDir();

  // TRUE wrapper entry, BEFORE reclaim/identity/manifest steps: allocate the
  // generation number and feed the GENERATION ledger [R12] — a wrapper that
  // KeepAlive-loops on any of the later fail-closed steps (corrupt manifest,
  // identity capture, bind timeout) must still escalate. Never stamps
  // last-restart (no perpetual grace renewal). nextGenNumber() also counts
  // ARCHIVED manifests, so the number is stable across the reclaim below.
  const gen = nextGenNumber(deps, paths);
  appendGenerationStart(deps, paths, gen);
  // Mode is recorded at entry too, so an intervening `rdv stop` routes to the
  // prod stop path even while this generation is still starting.
  saveMode("prod");

  prepareStandalone();
  const config = CONFIG.prod;

  // Pre-spawn reclaim: every existing generation is prior art now. Corrupt
  // manifests fail CLOSED — never guess [R3].
  let reclaim: ReclaimResult;
  try {
    reclaim = await reclaimPriorGenerations(deps, paths, { currentGen: null });
  } catch (err) {
    if (err instanceof CorruptManifestError || err instanceof SupervisionEvidenceError) {
      console.error(`\n${err.message}`);
      fgLock?.release();
      process.exit(1);
    }
    throw err;
  }
  // A prior generation that could not be resolved (survivor process, occupied
  // pgroup, or an in-flight spawn whose outcome is unknown) MUST fail the
  // start [F4]. Spawning anyway means either a bind crash-loop or — worse —
  // two live generations racing over one socket path, which is the outage
  // this whole design exists to prevent. Log-and-proceed is not an option.
  if (reclaim.unresolvedGens.length > 0) {
    console.error(
      `\nFAIL-CLOSED: refusing to start generation ${gen} — prior generation(s) are not verifiably gone:\n` +
        reclaim.unresolvedGens.map((u) => `  generation ${u.gen}: ${u.detail}`).join("\n") +
        `\n\nInspect with:            bun run scripts/rdv.ts doctor-supervision` +
        `\nRetire with consent:     bun run scripts/rdv.ts doctor-supervision --force-reclaim` +
        `\n\n--force-reclaim retires these generations (archiving their manifests and unlinking their` +
        `\nsockets) after verifying with lsof that no live process holds those sockets; it REFUSES` +
        `\nany generation whose socket still has a holder, so stop that process first if it reports one.`,
    );
    fgLock?.release();
    process.exit(1);
  }

  const wrapperId = captureProcId(deps, process.pid);
  if (!wrapperId) {
    console.error("Could not capture own process identity (sysctl kern.proc.pid failed)");
    fgLock?.release();
    process.exit(1);
  }

  // The manifest exists on disk BEFORE any spawn, and each child is recorded
  // (identity at spawn time) BEFORE waiting on its bind — so a `starting`
  // generation is never invisible to stop/deploy exit checks or reclaim, even
  // though the current-generation POINTER only flips at full publish [R3].
  const manifest: GenerationManifest = {
    gen,
    phase: "starting",
    startedAt: deps.now(),
    wrapper: wrapperId,
    sockets: {},
  };
  writeManifest(deps, paths, manifest);

  // Use centralized database at ~/.remote-dev/sqlite.db for all modes
  const prodDatabaseUrl = `file:${join(DATA_DIR, "sqlite.db")}`;

  console.log(`\nStarting Remote Dev in PROD mode (generation ${gen}, Unix sockets)`);
  console.log(`  Next.js:  ${config.nextSocket}`);
  console.log(`  Terminal: ${config.terminalSocket}`);
  console.log(`  Auth URL: ${config.nextAuthUrl}`);
  console.log(`  Database: ${join(DATA_DIR, "sqlite.db")}`);
  if (legacyPlist) {
    // In the banner (and therefore in nextjs.log/terminal.log's start marker)
    // so the upgrade is visible to whoever reads the logs, not just to whoever
    // happened to watch the start.
    console.warn(`  WARNING:  ${LEGACY_PLIST_WARNING}`);
  }
  console.log("");

  let exiting = false;
  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (exiting) return;
    exiting = true;
    console.log(`\n${reason}, shutting down generation ${gen}...`);
    updateManifestPhase(deps, paths, gen, "stopping");

    // Concurrent PGID shutdown of BOTH children [F8] — bounded well under the
    // plist's ExitTimeOut 30. Group-signalling children is safe (and required):
    // they are detached, so the group is exactly their own tree.
    const children = [manifest.next, manifest.terminal].filter((id): id is ProcId => Boolean(id));
    // Children spawned but not yet identity-captured [F4]: signal them by the
    // pid recorded at spawn (and its group — pgid == pid for detached children).
    const pending = (manifest.spawning ?? []).filter((p) => p.pid !== undefined);
    const pendingAlive = (): boolean =>
      pending.some(
        (p) => isPidAliveDeps(deps, p.pid as number) || pgroupOccupied(deps, p.pgid ?? (p.pid as number)),
      );
    const signalAll = (signal: NodeJS.Signals): void => {
      for (const id of children) {
        if (verifyProcIdentity(deps, id)) signalPgid(deps, id.pgid, signal);
      }
      for (const p of pending) {
        signalPid(deps, p.pid as number, signal);
        signalPgid(deps, p.pgid ?? (p.pid as number), signal);
      }
    };
    signalAll("SIGTERM");
    const deadline = deps.now() + 25_000;
    while (
      deps.now() < deadline &&
      (children.some((id) => verifyProcIdentity(deps, id)) || pendingAlive())
    ) {
      await deps.sleep(200);
    }
    signalAll("SIGKILL");
    // Post-SIGKILL death check [R3]: sockets are unlinked only once every
    // child is FULLY dead — leader verifiably dead (quad-state; "identity-
    // unavailable" is not dead) AND its detached pgroup EMPTY (a grandchild
    // can outlive a dead `bun run tsx` leader and still own the socket).
    const killDeadline = deps.now() + 2_000;
    while (
      deps.now() < killDeadline &&
      (!children.every((id) => procEntryFullyDead(deps, id)) || pendingAlive())
    ) {
      await deps.sleep(100);
    }
    const survivors = children.filter((id) => !procEntryFullyDead(deps, id));
    // An in-flight spawn that is still alive (or whose outcome was never
    // known) counts as a survivor too — its socket must not be unlinked.
    const pendingSurvivors = pending.filter(
      (p) => isPidAliveDeps(deps, p.pid as number) || pgroupOccupied(deps, p.pgid ?? (p.pid as number)),
    );
    const unknownSpawns = (manifest.spawning ?? []).filter((p) => p.pid === undefined);
    if (survivors.length > 0 || pendingSurvivors.length > 0 || unknownSpawns.length > 0) {
      console.error(
        `Children not verifiably gone after SIGKILL (pids ${[
          ...survivors.map((s) => String(s.pid)),
          ...pendingSurvivors.map((p) => `in-flight ${p.child} ${p.pid}`),
          ...unknownSpawns.map((p) => `in-flight ${p.child} (spawn outcome unknown)`),
        ].join(", ")}) — leaving sockets + manifest in place for the next reclaim.`,
      );
    } else {
      // Socket cleanup is the WRAPPER's job, gated on the dev/ino rule [R2] —
      // the children never unlink.
      unlinkOwnedSocket(deps, paths.nextSocket, manifest.sockets.next);
      unlinkOwnedSocket(deps, paths.terminalSocket, manifest.sockets.terminal);
    }

    // The manifest is deliberately NOT self-archived: this wrapper is still
    // alive while archiving would run, and archived manifests are invisible
    // to generation enumeration — a survivor would vanish from every check.
    // The manifest stays (phase=stopping) and the NEXT starter's reclaim
    // archives it only after verifying every recorded process is dead.
    removePid(NEXT_PID_FILE);
    removePid(TERMINAL_PID_FILE);
    clearMode();
    fgLock?.release();
    process.exit(exitCode);
  };

  process.on("SIGINT", () => void shutdown("Received SIGINT", 0));
  process.on("SIGTERM", () => void shutdown("Received SIGTERM", 0));

  // Start terminal server first; record identity + socket dev/ino on bind.
  // The placeholder goes on disk BEFORE spawn(2) can create a process, and the
  // pid is written the instant spawn returns — so no SIGKILL window can leave
  // a live child (or its socket claim) invisible to shutdown/reclaim [F4].
  const terminalCmd = ["bun", "run", "tsx", "src/server/index.ts"];
  beginChildSpawn(deps, paths, manifest, "terminal", config.terminalSocket, terminalCmd);
  const terminalProc = await startServer(
    "Terminal Server",
    terminalCmd,
    {
      TERMINAL_SOCKET: config.terminalSocket,
      DATABASE_URL: prodDatabaseUrl,
    },
    TERMINAL_PID_FILE,
    TERMINAL_LOG_FILE,
    (pid) => recordChildSpawnPid(deps, paths, manifest, "terminal", pid),
  );
  if (!terminalProc?.pid) {
    // spawn produced no process at all — the outcome IS known, so the
    // placeholder can be dropped.
    abandonChildSpawn(deps, paths, manifest, "terminal");
    await shutdown("Terminal server failed to spawn", 1);
    return;
  }
  // A generation may only be PUBLISHED when every child is identity-capturable
  // and every socket ownership-checkable — an unverifiable entry could never
  // be safely signalled or reclaimed later. Fail the start instead [R3].
  const terminalId = captureProcId(deps, terminalProc.pid);
  if (!terminalId) {
    await killUnidentifiedChild(deps, paths, manifest, "terminal", terminalProc.pid);
    await shutdown("Could not capture terminal server identity (pgid/start time)", 1);
    return;
  }
  // Promote the placeholder to a full child record in ONE atomic write.
  completeChildSpawn(deps, paths, manifest, "terminal", terminalId);
  if (!(await waitForSocketPath(config.terminalSocket, 60_000))) {
    await shutdown("Terminal server never bound its socket (60s)", 1);
    return;
  }
  const terminalSock = captureSocketId(deps, config.terminalSocket);
  if (!terminalSock) {
    await shutdown("Could not capture terminal socket identity (dev/ino)", 1);
    return;
  }
  manifest.sockets.terminal = terminalSock;
  writeManifest(deps, paths, manifest);

  // Start Next.js with socket and correct NEXTAUTH_URL for prod
  const nextCmd = [...config.nextCmd];
  beginChildSpawn(deps, paths, manifest, "next", config.nextSocket, nextCmd);
  const nextProc = await startServer(
    "Next.js",
    nextCmd,
    {
      SOCKET_PATH: config.nextSocket,
      TERMINAL_SOCKET: config.terminalSocket,
      DATABASE_URL: prodDatabaseUrl,
      NEXTAUTH_URL: config.nextAuthUrl,
      AUTH_URL: config.nextAuthUrl, // NextAuth v5 also checks AUTH_URL
    },
    NEXT_PID_FILE,
    NEXT_LOG_FILE,
    (pid) => recordChildSpawnPid(deps, paths, manifest, "next", pid),
  );
  if (!nextProc?.pid) {
    abandonChildSpawn(deps, paths, manifest, "next");
    await shutdown("Next.js failed to spawn", 1);
    return;
  }
  const nextId = captureProcId(deps, nextProc.pid);
  if (!nextId) {
    await killUnidentifiedChild(deps, paths, manifest, "next", nextProc.pid);
    await shutdown("Could not capture Next.js identity (pgid/start time)", 1);
    return;
  }
  completeChildSpawn(deps, paths, manifest, "next", nextId);
  if (!(await waitForSocketPath(config.nextSocket, 120_000))) {
    await shutdown("Next.js never bound its socket (120s)", 1);
    return;
  }
  const nextSock = captureSocketId(deps, config.nextSocket);
  if (!nextSock) {
    await shutdown("Could not capture Next.js socket identity (dev/ino)", 1);
    return;
  }
  manifest.sockets.next = nextSock;

  // Both children + sockets recorded → phase running, THEN flip the pointer
  // (the atomic publish point [R3]).
  manifest.phase = "running";
  writeManifest(deps, paths, manifest);
  flipCurrentGen(deps, paths, gen);

  // A FOREGROUND start/restart is an actuation — recorded only NOW, after the
  // generation actually published (never before the start succeeded) [F17].
  if (fgLock && foregroundActuationReason) {
    recordActuation(deps, paths, "rdv", foregroundActuationReason);
  }

  try {
    await ensureLocalApiKey();
  } catch (err) {
    console.warn("Warning: could not provision local API key:", err);
  }

  console.log(`\nRemote Dev started in PROD mode (generation ${gen})`);

  const raced = await Promise.race([
    terminalProc.exited.then((code) => ({ name: "Terminal Server", code })),
    nextProc.exited.then((code) => ({ name: "Next.js", code })),
  ]);
  await shutdown(`${raced.name} exited (code: ${raced.code ?? "unknown"})`, raced.code ?? 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status (§3.7 — truthful)
// ─────────────────────────────────────────────────────────────────────────────

function statusProd(deps: SupervisionDeps, paths: SupervisionPaths): boolean {
  const jobLoaded = launchdJobLoaded(deps, PROD_LABEL);
  const desired = readDesiredState(deps, paths);
  const gen = readCurrentGen(deps, paths);
  // ALL live manifests are evidence — an unpublished `starting` generation is
  // real even though the pointer has not flipped yet [R11].
  const { manifests, corruptGens } = readAllLiveManifests(deps, paths);

  // launchd UNKNOWN is evidence too [R11]: "launchctl could not be queried"
  // never justifies printing "No servers running" — the stack may be up.
  const hasEvidence =
    jobLoaded === true ||
    jobLoaded === "unknown" ||
    manifests.length > 0 ||
    corruptGens.length > 0 ||
    desired !== null;
  if (!hasEvidence) return false;

  console.log("\nPROD Mode (launchd-supervised, Unix sockets):");
  console.log(
    `  launchd:   ${PROD_LABEL} ${
      jobLoaded === "unknown" ? "UNKNOWN (launchctl unavailable)" : jobLoaded ? "LOADED" : "NOT LOADED"
    }`,
  );
  console.log(
    `  Desired:   ${desired === "corrupt" ? "CORRUPT (repair with `rdv start prod` / `rdv stop`)" : desired ? desired.state : "(unset)"}`,
  );

  if (corruptGens.length > 0) {
    console.log(
      `  Generation manifest(s) ${corruptGens.join(", ")}: CORRUPT — run \`rdv doctor-supervision --force-reclaim\``,
    );
    if (manifests.length === 0) return true;
  }
  if (manifests.length === 0) {
    if (jobLoaded === "unknown") {
      // "No manifest" is only evidence about OUR bookkeeping. With launchctl
      // unqueryable, a launchd-owned stack could be running right now, so
      // concluding "no servers running" would be a claim the evidence does not
      // support.
      console.log(
        "  No generation manifest, and launchctl could not be queried — prod state is UNKNOWN\n" +
          `    Remediation: launchctl print gui/$(id -u)/${PROD_LABEL}; ` +
          "curl --unix-socket ~/.remote-dev/run/nextjs.sock http://localhost/api/healthz",
      );
      return true;
    }
    console.log("  No generation manifest — no servers running");
    return true;
  }

  // EVERY live manifest is reported, not just the pointed one [R11]: a live
  // `starting` generation whose pointer has not flipped is exactly the state
  // an operator most needs to see, and hiding it made status lie during the
  // window that matters.
  const watchdogState = readWatchdogState(deps, paths);
  for (const manifest of [...manifests].sort((a, b) => a.gen - b.gen)) {
    const published = gen !== null && manifest.gen === gen;
    const ageSec = Math.floor((deps.now() - manifest.startedAt) / 1000);
    console.log(
      `  Generation ${manifest.gen} (phase ${manifest.phase}, age ${ageSec}s${
        published ? ", CURRENT" : ", UNPUBLISHED — pointer not flipped to this generation"
      }):`,
    );

    const rows: Array<{ name: string; slot: ChildSlot; id: ProcId | undefined; socket: string }> = [
      { name: "Next.js ", slot: "next", id: manifest.next, socket: paths.nextSocket },
      { name: "Terminal", slot: "terminal", id: manifest.terminal, socket: paths.terminalSocket },
    ];
    // Flap certainty comes from the watchdog's gen-keyed 2-tick persistence,
    // never from generation age alone [R11]: "UNREACHABLE … flap suspected"
    // only once BOTH grace has passed AND the persistence threshold is met.
    const flapConfirmedTicks = watchdogState.gen === manifest.gen ? watchdogState.flapTicks : 0;
    for (const row of rows) {
      const idState = row.id ? procIdentityState(deps, row.id) : null;
      const socketPresent = deps.fs.lstatSync(row.socket) !== null;
      let stateText: string;
      if (!row.id || idState === null) {
        const inFlight = (manifest.spawning ?? []).find((p) => p.child === row.slot);
        stateText = inFlight
          ? inFlight.pid === undefined
            ? "SPAWNING (spawn outcome unknown — see `rdv doctor-supervision`)"
            : `SPAWNING (pid ${inFlight.pid}, identity not yet captured)`
          : "(not recorded)";
      } else if (idState === "dead") {
        stateText = `STOPPED (pid ${row.id.pid} dead)`;
      } else if (idState === "alive-different-identity") {
        stateText = `STALE (pid ${row.id.pid} recycled by another process)`;
      } else if (idState === "identity-unavailable") {
        // Truthful about what we DON'T know — never presented as dead [R13].
        stateText = `UNVERIFIABLE (pid ${row.id.pid} alive but identity unavailable — sysctl failed)`;
      } else if (socketPresent) {
        stateText = `RUNNING (PID ${row.id.pid}, verified)`;
      } else if (ageSec <= GRACE_SECONDS) {
        // Socket-absent + PID-alive within grace = a normal boot in progress.
        stateText = `STARTING (PID ${row.id.pid} verified alive, socket not yet bound)`;
      } else if (flapConfirmedTicks >= FLAP_TICKS_REQUIRED) {
        stateText = `UNREACHABLE (socket unlinked — flap suspected; PID ${row.id.pid} verified alive)`;
      } else {
        stateText =
          `SOCKET ABSENT (PID ${row.id.pid} verified alive; flap unconfirmed — ` +
          `watchdog persistence ${flapConfirmedTicks}/${FLAP_TICKS_REQUIRED})`;
      }
      console.log(`    ${row.name}: ${stateText}`);
    }
    const wrapperState = procIdentityState(deps, manifest.wrapper);
    const wrapperText =
      wrapperState === "alive-same-identity"
        ? `RUNNING (PID ${manifest.wrapper.pid}, verified)`
        : wrapperState === "identity-unavailable"
          ? `UNVERIFIABLE (pid ${manifest.wrapper.pid} alive but identity unavailable)`
          : wrapperState === "alive-different-identity"
            ? `STALE (pid ${manifest.wrapper.pid} recycled)`
            : `STOPPED (pid ${manifest.wrapper.pid} dead)`;
    console.log(`    Wrapper : ${wrapperText}`);
  }
  return true;
}

function status(): void {
  ensurePidDir();

  const nextPid = readPid(NEXT_PID_FILE);
  const terminalPid = readPid(TERMINAL_PID_FILE);

  console.log("\nRemote Dev Status");
  console.log("─".repeat(40));

  // Check dev mode (ports)
  const devConfig = CONFIG.dev;
  const devNextPid = getProcessOnPort(devConfig.nextPort);
  const devTerminalPid = getProcessOnPort(devConfig.terminalPort);
  const devRunning = devNextPid || devTerminalPid;

  if (devRunning) {
    console.log(`\nDEV Mode (ports ${devConfig.nextPort}, ${devConfig.terminalPort}):`);
    console.log(`  Next.js:   ${devNextPid ? `RUNNING (PID: ${devNextPid})` : "STOPPED"}`);
    console.log(`  Terminal:  ${devTerminalPid ? `RUNNING (PID: ${devTerminalPid})` : "STOPPED"}`);
  }

  // Prod: truthful launchd + generation-manifest report [R11].
  const deps = realDeps();
  const paths = supervisionPaths(process.env);
  const prodShown = statusProd(deps, paths);

  // "No servers running" ONLY with no manifest/launchd/desired evidence [R11].
  if (!devRunning && !prodShown) {
    console.log("\nNo servers running");
  }

  // Clean up stale PID files (informational legacy files only)
  if (nextPid && !isProcessRunning(nextPid)) removePid(NEXT_PID_FILE);
  if (terminalPid && !isProcessRunning(terminalPid)) removePid(TERMINAL_PID_FILE);

  console.log("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Command dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function start(mode: Mode, launchdChildFlag: boolean): Promise<void> {
  if (mode === "prod") {
    await startProd(launchdChildFlag);
  } else {
    await startDev();
  }
}

async function stop(): Promise<void> {
  const deps = realDeps();
  const paths = supervisionPaths(process.env);
  const targetMode = getRunningMode();
  const prodJobLoaded = launchdJobLoaded(deps, PROD_LABEL);

  // Prod evidence that outranks a missing/stale mode file: a manifest that is
  // not verifiably dead (a live foreground wrapper leaves no mode file if it
  // was killed), corrupt manifests, or — with launchctl UNQUERYABLE — an
  // installed prod plist. Routing any of these to stopDev() would report
  // success while the prod stack kept running; stopProd()'s decision table
  // fails closed on exactly these states instead.
  const { manifests, corruptGens } = readAllLiveManifests(deps, paths);
  const liveProdManifest = manifests.some((m) => !manifestFullyDead(deps, m));
  const prodPlistInstalled = existsSync(paths.prodPlist);
  const routeToProd =
    targetMode === "prod" ||
    prodJobLoaded === true ||
    liveProdManifest ||
    corruptGens.length > 0 ||
    (prodJobLoaded === "unknown" && prodPlistInstalled);

  if (routeToProd) {
    await stopProd();
    return;
  }
  stopDev();
}

async function restart(mode?: Mode): Promise<void> {
  const currentMode = mode || getRunningMode() || "dev";
  if (currentMode === "prod") {
    await restartProd();
    return;
  }
  console.log(`Restarting in DEV mode...\n`);
  stopDev();
  await Bun.sleep(1000);
  await startDev();
}

// Main
const cliArgs = process.argv.slice(2);
const launchdChildFlag = cliArgs.includes("--launchd-child");
const positional = cliArgs.filter((a) => !a.startsWith("--"));
const [command, modeArg] = positional;
const mode = (modeArg === "prod" ? "prod" : "dev") as Mode;

// Supervision EVIDENCE that cannot be READ (an unreadable generations
// directory, a failing lstat) is never "nothing is running": every command
// fails closed with remediation rather than acting on absent evidence.
async function runCommand(): Promise<void> {
  try {
    await dispatch();
  } catch (err) {
    if (err instanceof SupervisionEvidenceError) {
      failClosed(
        `${err.message}\nSupervision state could not be read, so this command refuses to act. ` +
          "Fix the filesystem condition (permissions/disk), then retry.",
      );
    }
    throw err;
  }
}

async function dispatch(): Promise<void> {
  switch (command) {
    case "start":
      await start(mode, launchdChildFlag);
      break;
    case "stop":
      await stop();
      break;
    case "restart":
      await restart(modeArg as Mode | undefined);
      break;
    case "status":
      status();
      break;
    case "doctor-supervision": {
      const code = await doctorSupervision(realDeps(), supervisionPaths(process.env), {
        forceReclaim: cliArgs.includes("--force-reclaim"),
      });
      process.exit(code);
      break;
    }
    default:
      console.log(`
Remote Dev Process Manager

Usage: bun run scripts/rdv.ts <command> [mode]

Commands:
  start [dev|prod]   Start servers (default: dev). Prod delegates to launchd
                     when the ${PROD_LABEL} job/plist is present.
  stop               Stop all servers (prod: launchctl bootout + desired=stopped)
  restart [dev|prod] Restart servers (prod: launchctl kickstart -k)
  status             Show server status (prod: launchd + generation manifest)
  doctor-supervision Print supervision state; --force-reclaim reclaims prior
                     generations with explicit operator consent

Modes:
  dev   Development (ports 6001, 6002)
  prod  Production  (Unix sockets: ${CONFIG.prod.nextSocket}, ${CONFIG.prod.terminalSocket})

Examples:
  bun run rdv start          # Start dev servers
  bun run rdv start prod     # Start prod (launchd delegation)
  bun run rdv stop           # Stop all servers
  bun run rdv restart        # Restart in current mode
  bun run rdv status         # Check status
`);
  }
}

await runCommand();
