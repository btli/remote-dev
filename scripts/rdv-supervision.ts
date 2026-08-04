#!/usr/bin/env bun
/**
 * Prod Supervision Core (remote-dev-7fsq — Spec v3: single-owner prod supervision)
 *
 * launchd (`dev.remote.app.prod`) is the SOLE process owner of the prod stack.
 * Every other actor — watchdog, deploy.ts, humans/agents running rdv commands —
 * signals launchd instead of spawning/killing processes itself, and NOTHING
 * kills a process or unlinks a socket it cannot prove it owns (generation
 * manifests + process identity + socket dev/ino, §3.3 of the spec).
 *
 * This module is the single home for all lock-holding, manifest, custody, and
 * actuator logic [R7]:
 *   - control/foreground kernel flocks (§3.1) via the PURE flock primitive in
 *     deploy-flock.ts [R14] — file content is informational, never a liveness
 *     signal;
 *   - launchd job detection by `launchctl print` EXIT STATUS only [F10] and
 *     launchd provenance (ppid==1 + XPC_SERVICE_NAME) [F2, R1];
 *   - immutable per-generation manifests + the atomic current-generation
 *     pointer [R3];
 *   - process identity via `sysctl -b kern.proc.pid` start time (stable,
 *     locale-free — NOT `ps -o lstart`) [R13];
 *   - socket ownership by recorded dev/ino; the unlink rule [R2];
 *   - the durable desired-state file [R5];
 *   - restart + generation ledgers with escalation [F17, R12];
 *   - deploy custody-journal recovery classification [R4];
 *   - the `watchdog-act <reason>` recovery transaction (§3.6) and
 *     `doctor-supervision [--force-reclaim]`.
 *
 * TESTABILITY: everything routes through an injectable `SupervisionDeps`
 * (exec/fs/clock/kill/identity), so the logic is unit-testable under
 * vitest/node. This file must therefore NEVER statically import `bun` or
 * `bun:ffi` — the flock primitive is loaded lazily inside realDeps() only.
 *
 * Scope: macOS self-hosted prod. `rdv.ts` (delegation + wrapper), `deploy.ts`
 * (LaunchdCustody) and `install-supervision.ts` consume this module.
 */

import { spawnSync as nodeSpawnSync } from "node:child_process";
import {
  existsSync as fsExistsSync,
  readFileSync as fsReadFileSync,
  writeFileSync as fsWriteFileSync,
  appendFileSync as fsAppendFileSync,
  renameSync as fsRenameSync,
  unlinkSync as fsUnlinkSync,
  mkdirSync as fsMkdirSync,
  readdirSync as fsReaddirSync,
  lstatSync as fsLstatSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
// Pure codec — no fs/process/bun:ffi; safe under vitest/node.
import { parseLockContent } from "./deploy-lock";
import { restoreStandalone } from "./deploy-lib";
import type { PureFlockHandle } from "./deploy-flock";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const PROD_LABEL = "dev.remote.app.prod";
export const WATCHDOG_LABEL = "dev.remote.app.watchdog";

/** Post-actuation grace window: failures are counted but action deferred. */
export const GRACE_SECONDS = 120;
/** Consecutive failed watchdog ticks before the generic restart action. */
export const DEFAULT_MAX_FAILURES = 2;
/** Persisted consecutive flap ticks required for the flap fast-path [F7]. */
export const FLAP_TICKS_REQUIRED = 2;
/** Generation age below which a missing socket reads as STARTING, not flap. */
export const FLAP_MIN_GENERATION_AGE_SECONDS = 120;
/** Restart-rate escalation: >= threshold actuations within the window. */
export const ESCALATION_WINDOW_SECONDS = 3600;
export const ESCALATION_THRESHOLD = 3;
/** Control-lock contention: retry with backoff up to this budget, then abort. */
export const CONTROL_LOCK_TIMEOUT_MS = 30_000;
/** SIGTERM→SIGKILL grace during reclaim of prior-generation processes. */
export const RECLAIM_TERM_WAIT_MS = 5_000;

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

export interface SupervisionPaths {
  dataDir: string;
  runDir: string;
  pidDir: string;
  deployDir: string;
  /** Control lock: any actuator transaction (§3.1). */
  controlLock: string;
  /** Foreground lock: the wrapper itself, only in job-absent foreground mode. */
  foregroundLock: string;
  /** Durable desired-state file [R5]. */
  desiredStateFile: string;
  generationsDir: string;
  generationsArchiveDir: string;
  /** One-line atomic pointer to the current generation number. */
  currentGenerationFile: string;
  /** Deploy custody journal [R4]. */
  custodyJournal: string;
  /** Terminal deploy outcome the CI poll reads (`last-deploy.json`). */
  deployResultFile: string;
  /** Actuator stamp — the watchdog's grace window anchor [F7, F12]. */
  lastRestartStamp: string;
  /** `<epoch> <actor> <reason>` per actuation [F17]. */
  restartLedger: string;
  /** `<epoch> generation-start <gen>` per wrapper start (KeepAlive respawns). */
  generationLedger: string;
  /** Watchdog persistence (failures + gen-keyed flap ticks). */
  watchdogStateFile: string;
  nextSocket: string;
  terminalSocket: string;
  deployLock: string;
  /** Single-use deploy-restart authorization token file (0600) [F11]. */
  deployRestartToken: string;
  /** Installed LaunchAgent plists (the live copies launchd reads). */
  prodPlist: string;
  watchdogPlist: string;
  /** Legacy PID files (informational; kept for status + legacy tooling). */
  nextPidFile: string;
  terminalPidFile: string;
  buildsDir: string;
  localApiKeyFile: string;
}

export function supervisionPaths(env: Record<string, string | undefined> = process.env): SupervisionPaths {
  const dataDir = env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
  const runDir = join(dataDir, "run");
  const pidDir = join(dataDir, "server");
  const deployDir = join(dataDir, "deploy");
  const home = env.HOME || homedir();
  const launchAgents = join(home, "Library", "LaunchAgents");
  return {
    dataDir,
    runDir,
    pidDir,
    deployDir,
    controlLock: join(runDir, "rdv-control.lock"),
    foregroundLock: join(runDir, "rdv-foreground.lock"),
    desiredStateFile: join(pidDir, "desired-state.json"),
    generationsDir: join(pidDir, "generations"),
    generationsArchiveDir: join(pidDir, "generations", "archive"),
    currentGenerationFile: join(pidDir, "current-generation"),
    custodyJournal: join(deployDir, "custody-journal.json"),
    deployResultFile: join(deployDir, "last-deploy.json"),
    lastRestartStamp: join(deployDir, "last-restart"),
    restartLedger: join(deployDir, "restart-ledger"),
    generationLedger: join(deployDir, "generation-ledger"),
    watchdogStateFile: join(deployDir, "watchdog-state.json"),
    nextSocket: join(runDir, "nextjs.sock"),
    terminalSocket: join(runDir, "terminal.sock"),
    deployLock: join(deployDir, "deploy.lock"),
    deployRestartToken: join(runDir, "deploy-restart-token"),
    prodPlist: join(launchAgents, `${PROD_LABEL}.plist`),
    watchdogPlist: join(launchAgents, `${WATCHDOG_LABEL}.plist`),
    nextPidFile: join(pidDir, "next.pid"),
    terminalPidFile: join(pidDir, "terminal.pid"),
    buildsDir: join(dataDir, "builds"),
    localApiKeyFile: join(dataDir, "rdv", ".local-key"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Injectable dependencies
// ─────────────────────────────────────────────────────────────────────────────

export interface LstatInfo {
  dev: number;
  ino: number;
  isSocket: boolean;
}

export interface FsDeps {
  existsSync(p: string): boolean;
  readFileSync(p: string): string;
  /** `mode` (when given) is the file's permission bits, e.g. 0o600. */
  writeFileSync(p: string, data: string, mode?: number): void;
  appendFileSync(p: string, data: string): void;
  renameSync(from: string, to: string): void;
  unlinkSync(p: string): void;
  /** Always recursive; must not throw when the dir exists. */
  mkdirSync(p: string): void;
  /**
   * Basenames of directory entries. ONLY ENOENT may read as "empty" ([]);
   * every other error MUST throw — an enumeration failure is
   * evidence-unavailable, not evidence of absence (a swallowed EACCES/EIO here
   * would let reclaim build an empty claim set and unlink LIVE sockets).
   */
  readdirSync(p: string): string[];
  /** null ONLY on ENOENT; every other error throws (evidence-unavailable). */
  lstatSync(p: string): LstatInfo | null;
}

/**
 * Evidence could not be READ (an fs error that is not ENOENT, an unreadable
 * directory, …). Distinct from "there is no evidence": callers must FAIL
 * CLOSED on this — never treat it as "nothing is running" [F4, R3].
 */
export class SupervisionEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisionEvidenceError";
  }
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SupervisionDeps {
  fs: FsDeps;
  /** Run a command synchronously; a spawn failure yields exitCode 127. */
  exec(cmd: string[]): ExecResult;
  /** Epoch milliseconds. */
  now(): number;
  sleep(ms: number): Promise<void>;
  /** process.kill semantics (throws ESRCH/EPERM); pid may be negative (pgid). */
  kill(pid: number, signal: NodeJS.Signals | 0): void;
  /**
   * Process start time in nanoseconds as a decimal string (from
   * `sysctl -b kern.proc.pid.<pid>` kern_proc p_starttime [R13]), or null if
   * the process does not exist / cannot be inspected.
   */
  procStartTimeNs(pid: number): string | null;
  uid(): number;
  /**
   * Attempt the PURE kernel flock on `path` (deploy-flock acquireFlock [R14]).
   * Returns null when held by a live process.
   */
  tryFlock(path: string): Promise<PureFlockHandle | null>;
  log(msg: string): void;
}

/** Real dependency wiring (bun/node runtime; never constructed under vitest). */
export function realDeps(): SupervisionDeps {
  return {
    fs: {
      existsSync: (p) => fsExistsSync(p),
      readFileSync: (p) => fsReadFileSync(p, "utf-8"),
      writeFileSync: (p, data, mode) =>
        mode === undefined ? fsWriteFileSync(p, data) : fsWriteFileSync(p, data, { mode }),
      appendFileSync: (p, data) => fsAppendFileSync(p, data),
      renameSync: (from, to) => fsRenameSync(from, to),
      unlinkSync: (p) => fsUnlinkSync(p),
      mkdirSync: (p) => fsMkdirSync(p, { recursive: true }),
      // ENOENT is DATA ("no such directory ⇒ no entries"); anything else is
      // evidence-unavailable and must propagate so callers fail closed.
      readdirSync: (p) => {
        try {
          return fsReaddirSync(p);
        } catch (err) {
          if (errCode(err) === "ENOENT") return [];
          throw new SupervisionEvidenceError(`cannot enumerate ${p}: ${String(err)}`);
        }
      },
      lstatSync: (p) => {
        try {
          const st = fsLstatSync(p);
          return { dev: st.dev, ino: st.ino, isSocket: st.isSocket() };
        } catch (err) {
          if (errCode(err) === "ENOENT") return null;
          throw new SupervisionEvidenceError(`cannot lstat ${p}: ${String(err)}`);
        }
      },
    },
    exec: (cmd) => {
      const res = nodeSpawnSync(cmd[0], cmd.slice(1), { encoding: "utf-8" });
      if (res.error) {
        return { exitCode: 127, stdout: "", stderr: String(res.error) };
      }
      return {
        exitCode: res.status ?? 1,
        stdout: res.stdout ?? "",
        stderr: res.stderr ?? "",
      };
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    kill: (pid, signal) => process.kill(pid, signal),
    procStartTimeNs: (pid) => readKernProcStartTimeNs(pid),
    uid: () => (typeof process.getuid === "function" ? process.getuid() : 0),
    tryFlock: async (path) => {
      // Lazy import: deploy-flock loads bun:ffi at module scope, which cannot
      // load under vitest/node — so the import happens only on real runs.
      const { acquireFlock } = await import("./deploy-flock");
      return acquireFlock(path);
    },
    log: (msg) => console.log(`[supervision] ${msg}`),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Process start time via sysctl kern.proc.pid [R13]
//
// The identity anchor is kern_proc's `p_starttime` — stable and locale-free,
// unlike `ps -o lstart`. The sysctl(8) CLI cannot resolve the special
// `kern.proc.pid.<pid>` node by name, so this reads sysctl(3) directly via
// bun:ffi with the numeric MIB {CTL_KERN, KERN_PROC, KERN_PROC_PID, pid}.
// For a live process, struct kinfo_proc starts with extern_proc whose first
// member is `p_starttime` (struct timeval: int64 tv_sec at offset 0, int32
// tv_usec at offset 8, little-endian on arm64/x86_64).
//
// The FFI module is loaded LAZILY via require() inside the real-deps path only
// (mirroring the deploy-flock lazy-load discipline) so importing this module
// under vitest/node never touches bun:ffi.
// ─────────────────────────────────────────────────────────────────────────────

interface SysctlFfi {
  read(pid: number): string | null;
}

let sysctlFfiCache: SysctlFfi | "unavailable" | null = null;

function loadSysctlFfi(): SysctlFfi | null {
  if (sysctlFfiCache === "unavailable") return null;
  if (sysctlFfiCache) return sysctlFfiCache;
  try {
    interface BunFfiModule {
      dlopen(
        name: string,
        symbols: Record<string, { args: unknown[]; returns: unknown }>,
      ): { symbols: Record<string, (...args: unknown[]) => unknown> };
      FFIType: Record<string, unknown>;
      ptr(view: ArrayBufferView): unknown;
    }
    // Bun supports CommonJS require() everywhere; under vitest/node this line
    // is never reached (tests inject procStartTimeNs).
    const { dlopen, FFIType, ptr } = require("bun:ffi") as BunFfiModule;
    const lib = dlopen("libSystem.dylib", {
      sysctl: {
        args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64],
        returns: FFIType.i32,
      },
    });
    const CTL_KERN = 1;
    const KERN_PROC = 14;
    const KERN_PROC_PID = 1;
    sysctlFfiCache = {
      read(pid: number): string | null {
        try {
          const mib = new Int32Array([CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]);
          const out = new Uint8Array(1024);
          const lenBuf = new BigUint64Array([BigInt(out.length)]);
          const rc = lib.symbols.sysctl(ptr(mib), 4, ptr(out), ptr(lenBuf), null, 0) as number;
          if (rc !== 0) return null;
          // A missing pid "succeeds" with oldlen 0 — treat anything shorter
          // than the timeval as "process not found".
          if (Number(lenBuf[0]) < 12) return null;
          const dv = new DataView(out.buffer);
          const sec = dv.getBigInt64(0, true);
          const usec = BigInt(dv.getInt32(8, true));
          // BigInt() calls (not literals) keep this compatible with the repo's
          // pre-ES2020 tsc target while preserving nanosecond precision.
          if (sec <= BigInt(0)) return null;
          return (sec * BigInt(1_000_000_000) + usec * BigInt(1_000)).toString();
        } catch {
          return null;
        }
      },
    };
    return sysctlFfiCache;
  } catch {
    sysctlFfiCache = "unavailable";
    return null;
  }
}

/** Real-deps start-time reader (null = process gone / FFI unavailable). */
function readKernProcStartTimeNs(pid: number): string | null {
  return loadSysctlFfi()?.read(pid) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic file helpers (temp+rename)
// ─────────────────────────────────────────────────────────────────────────────

function writeAtomic(deps: SupervisionDeps, path: string, data: string): void {
  deps.fs.mkdirSync(dirname(path));
  const tmp = `${path}.tmp.${Math.floor(Math.random() * 1e9)}`;
  deps.fs.writeFileSync(tmp, data);
  deps.fs.renameSync(tmp, path);
}

// ─────────────────────────────────────────────────────────────────────────────
// launchd: job detection (exit-status only [F10]) + provenance [F2, R1]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is the launchd job loaded? Decided by the EXIT STATUS of `launchctl print`
 * ONLY — never by parsing its output [F10]. "unknown" (launchctl missing /
 * unrunnable) must be handled fail-closed by callers [F9].
 */
export function launchdJobLoaded(deps: SupervisionDeps, label: string): boolean | "unknown" {
  const res = deps.exec(["launchctl", "print", `gui/${deps.uid()}/${label}`]);
  if (res.exitCode === 127) return "unknown";
  return res.exitCode === 0;
}

/**
 * Launchd provenance for the `--launchd-child` wrapper branch [F2, R1]: the
 * flag alone is forgeable, so require ppid==1 AND XPC_SERVICE_NAME matching
 * the job label (exact, or the final path component of a `gui/…/<label>`
 * form). Forged invocations fall through to the delegation logic instead.
 */
export function verifyLaunchdProvenance(
  ppid: number,
  xpcServiceName: string | undefined,
  label: string,
): boolean {
  if (ppid !== 1) return false;
  if (!xpcServiceName) return false;
  if (xpcServiceName === label) return true;
  const lastSegment = xpcServiceName.split("/").pop();
  return lastSegment === label;
}

export function kickstartJob(deps: SupervisionDeps, label: string): boolean {
  const res = deps.exec(["launchctl", "kickstart", "-k", `gui/${deps.uid()}/${label}`]);
  if (res.exitCode !== 0) {
    deps.log(`launchctl kickstart -k ${label} failed (exit ${res.exitCode}): ${res.stderr.trim()}`);
  }
  return res.exitCode === 0;
}

export function bootoutJob(deps: SupervisionDeps, label: string): boolean {
  const res = deps.exec(["launchctl", "bootout", `gui/${deps.uid()}/${label}`]);
  if (res.exitCode !== 0) {
    deps.log(`launchctl bootout ${label} failed (exit ${res.exitCode}): ${res.stderr.trim()}`);
  }
  return res.exitCode === 0;
}

export function bootstrapJob(deps: SupervisionDeps, plistPath: string): boolean {
  const res = deps.exec(["launchctl", "bootstrap", `gui/${deps.uid()}`, plistPath]);
  if (res.exitCode !== 0) {
    deps.log(`launchctl bootstrap ${plistPath} failed (exit ${res.exitCode}): ${res.stderr.trim()}`);
  }
  return res.exitCode === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Desired state [R5]
// ─────────────────────────────────────────────────────────────────────────────

export type DesiredStateValue = "running" | "stopped" | "maintenance";

export interface DesiredState {
  state: DesiredStateValue;
  owner?: { pid: number; startTimeNs: string };
  ts: number;
}

/**
 * Read the desired state. Three outcomes, and the distinction matters [R5]:
 *   - null: the file has never been written (legacy/fresh host). Callers may
 *     treat this as "running" (bootstrap-era compat) — an unmanaged host
 *     predates intentional stops, so there is nothing to preserve.
 *   - "corrupt": the file EXISTS but cannot be trusted. It may have said
 *     `stopped` — callers that GATE on desired state (the watchdog, restart
 *     refusal) must FAIL CLOSED, never guess "running". Commands that only
 *     REWRITE the file (`rdv start prod` / `rdv stop`) may tolerate it — the
 *     atomic rewrite IS the repair.
 *   - a parsed DesiredState.
 */
export function readDesiredState(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
): DesiredState | "corrupt" | null {
  if (!deps.fs.existsSync(paths.desiredStateFile)) return null;
  try {
    const parsed = JSON.parse(deps.fs.readFileSync(paths.desiredStateFile)) as DesiredState;
    if (parsed.state === "running" || parsed.state === "stopped" || parsed.state === "maintenance") {
      return parsed;
    }
  } catch {
    // fall through — an unreadable/unparseable file is CORRUPT, not absent.
  }
  return "corrupt";
}

export function writeDesiredState(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  state: DesiredStateValue,
  owner?: { pid: number; startTimeNs: string },
): void {
  const record: DesiredState = { state, ts: deps.now(), ...(owner ? { owner } : {}) };
  writeAtomic(deps, paths.desiredStateFile, JSON.stringify(record, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Process identity [R13]
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcId {
  pid: number;
  pgid: number;
  /** Decimal nanoseconds string (bigint-safe in JSON). */
  startTimeNs: string;
}

/** Capture a process's identity (pid + pgid + start time), or null if gone. */
export function captureProcId(deps: SupervisionDeps, pid: number): ProcId | null {
  const startTimeNs = deps.procStartTimeNs(pid);
  if (startTimeNs === null) return null;
  const res = deps.exec(["ps", "-o", "pgid=", "-p", String(pid)]);
  if (res.exitCode !== 0) return null;
  const pgid = parseInt(res.stdout.trim(), 10);
  if (!Number.isInteger(pgid) || pgid <= 0) return null;
  return { pid, pgid, startTimeNs };
}

/**
 * Quad-state process identity [R13]. Collapsing "dead" and "cannot inspect"
 * into one boolean is how a sysctl outage could get a LIVE foreign process's
 * socket unlinked — the four states must stay distinct:
 *   - "dead": the pid does not exist (sysctl empty AND kill(pid,0) ESRCH).
 *   - "alive-same-identity": live with the recorded start time — ours.
 *   - "alive-different-identity": live but recycled — NEVER ours to touch.
 *   - "identity-unavailable": the pid is alive (or EPERM-alive) but its start
 *     time cannot be read — ownership is UNPROVABLE; destructive actions must
 *     fail closed.
 */
export type ProcIdentityState =
  | "dead"
  | "alive-same-identity"
  | "alive-different-identity"
  | "identity-unavailable";

export function procIdentityState(deps: SupervisionDeps, id: ProcId): ProcIdentityState {
  const current = deps.procStartTimeNs(id.pid);
  if (current === null) {
    // sysctl yields nothing both for a MISSING pid and for an inspection
    // failure — disambiguate with the EPERM-aware liveness probe.
    return isPidAliveDeps(deps, id.pid) ? "identity-unavailable" : "dead";
  }
  return current === id.startTimeNs ? "alive-same-identity" : "alive-different-identity";
}

/**
 * Is the recorded identity still THIS process? True ONLY for
 * "alive-same-identity" — the precondition for SIGNALLING. Death-gated
 * decisions (unlink/archive) must use procIdentityState() === "dead" instead:
 * !verifyProcIdentity is NOT proof of death [R13].
 */
export function verifyProcIdentity(deps: SupervisionDeps, id: ProcId): boolean {
  return procIdentityState(deps, id) === "alive-same-identity";
}

/**
 * Does the recorded process GROUP still contain signalable members?
 * `kill(-pgid, 0)`: success ⇒ occupied; ESRCH ⇒ empty; EPERM/anything else ⇒
 * members exist that we cannot signal (or unknown) — treated as OCCUPIED
 * (fail closed). The recorded leader dying does not empty its group — a
 * detached grandchild (the real server under `bun run tsx`) can outlive it,
 * and unlinking its socket would recreate the outage class.
 */
export function pgroupOccupied(deps: SupervisionDeps, pgid: number): boolean {
  try {
    deps.kill(-pgid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code !== "ESRCH";
  }
}

/**
 * All-clear predicate for destructive cleanup of a CHILD entry: the recorded
 * leader is verifiably DEAD and its recorded process group is EMPTY. Children
 * are spawned `detached: true` (fresh pgroups whose lifetime is exactly the
 * server tree), so an occupied group here always means a surviving
 * descendant — e.g. the real node server under a dead `bun run tsx` leader.
 */
export function procEntryFullyDead(deps: SupervisionDeps, id: ProcId): boolean {
  return procIdentityState(deps, id) === "dead" && !pgroupOccupied(deps, id.pgid);
}

/**
 * Signal a process GROUP (`kill(-pgid)`) — a socket-holder pid is not
 * necessarily a group leader [F5]. ESRCH/EPERM on an already-gone group are
 * the success condition and are swallowed.
 *
 * ONLY ever use this for CHILD entries. Children are spawned `detached: true`,
 * so their pgroup is freshly created and contains exactly their own tree. The
 * WRAPPER's pgroup is NOT safe to signal: in job-absent foreground mode the
 * wrapper shares its group with the invoking interactive shell, so a group
 * signal would kill the operator's shell, the very command doing the restart,
 * and unrelated jobs. Signal the wrapper by LEADER PID (signalPid) instead —
 * its own SIGTERM handler shuts its children down.
 */
export function signalPgid(deps: SupervisionDeps, pgid: number, signal: NodeJS.Signals): void {
  try {
    deps.kill(-pgid, signal);
  } catch (err) {
    const code = errCode(err);
    if (code !== "ESRCH" && code !== "EPERM") throw err;
  }
}

/**
 * Signal a single process by LEADER PID (never its group) — the only safe way
 * to signal a wrapper, whose pgroup may be shared with an interactive shell.
 * ESRCH/EPERM (already gone / not ours to signal) are swallowed.
 */
export function signalPid(deps: SupervisionDeps, pid: number, signal: NodeJS.Signals): void {
  try {
    deps.kill(pid, signal);
  } catch (err) {
    const code = errCode(err);
    if (code !== "ESRCH" && code !== "EPERM") throw err;
  }
}

/**
 * PID liveness, fail-closed polarity: ONLY ESRCH proves absence. EPERM (alive
 * but not ours to signal) and EVERY other/unexpected error mean "cannot prove
 * it is gone" ⇒ treated as ALIVE. The inverse polarity is how a transient
 * kill(2) failure could classify a LIVE process as dead and get its socket
 * unlinked / its manifest archived.
 */
export function isPidAliveDeps(deps: SupervisionDeps, pid: number): boolean {
  try {
    deps.kill(pid, 0);
    return true;
  } catch (err) {
    return errCode(err) !== "ESRCH";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation manifests [R3]
// ─────────────────────────────────────────────────────────────────────────────

export interface SocketId {
  path: string;
  dev: number;
  ino: number;
}

export type ChildSlot = "next" | "terminal";

/**
 * A child slot that is BEING spawned [F4]. Written BEFORE `spawn()` is called
 * and cleared only when the spawn outcome is definitively known, so the window
 * between spawn(2) returning and the identity capture can never leave a live
 * process absent from every manifest (the original outage class: a childless
 * manifest gets archived and the live child's socket unlinked as an "orphan").
 *
 * `pid`/`pgid` are filled in SYNCHRONOUSLY the instant spawn() returns, before
 * anything else — children are detached, so pgid == pid. A placeholder with no
 * pid means the spawn outcome is UNKNOWN: its claimed socket must never be
 * orphan-unlinked and its generation can only be retired by proven full death
 * or an operator force-reclaim.
 */
export interface SpawnPlaceholder {
  child: ChildSlot;
  /** The socket path this child will claim — never orphan-unlink it. */
  socketPath: string;
  pid?: number;
  pgid?: number;
}

export interface GenerationManifest {
  gen: number;
  phase: "starting" | "running" | "stopping";
  /** Epoch ms the wrapper wrote the manifest — anchors generation age. */
  startedAt: number;
  /**
   * Epoch ms the wrapper entered `stopping`. This is the ONLY upper bound we
   * have on when a descendant of this generation could have been created, and
   * process-group attribution requires one (see attributeAndKillGroup): a
   * pgid recycled to a LATER, unrelated group also satisfies "started after
   * the generation", so a lower bound alone proves nothing.
   */
  stoppingAt?: number;
  wrapper: ProcId;
  next?: ProcId;
  terminal?: ProcId;
  sockets: { next?: SocketId; terminal?: SocketId };
  /**
   * The argv each child was spawned with, recorded at spawn time. Used to
   * POSITIVELY identify group members before signalling them — a timestamp
   * window is not proof of descent.
   */
  commands?: { next?: string[]; terminal?: string[] };
  /** In-flight spawns [F4]; empty/absent in the steady state. */
  spawning?: SpawnPlaceholder[];
}

export class CorruptManifestError extends Error {
  constructor(public readonly gen: number, public readonly file: string) {
    super(
      `Generation manifest ${file} is unreadable/corrupt. Refusing to reclaim blind — ` +
        `run \`rdv doctor-supervision --force-reclaim\` to reclaim with explicit operator consent.`,
    );
    this.name = "CorruptManifestError";
  }
}

function manifestFile(paths: SupervisionPaths, gen: number): string {
  return join(paths.generationsDir, `${gen}.json`);
}

function isValidProcId(v: unknown): v is ProcId {
  if (!v || typeof v !== "object") return false;
  const id = v as Partial<ProcId>;
  return (
    typeof id.pid === "number" &&
    Number.isInteger(id.pid) &&
    id.pid > 0 &&
    typeof id.pgid === "number" &&
    Number.isInteger(id.pgid) &&
    id.pgid > 0 &&
    typeof id.startTimeNs === "string" &&
    id.startTimeNs.length > 0
  );
}

function isValidSpawnPlaceholder(v: unknown): v is SpawnPlaceholder {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<SpawnPlaceholder>;
  if (p.child !== "next" && p.child !== "terminal") return false;
  if (typeof p.socketPath !== "string" || p.socketPath.length === 0) return false;
  for (const n of [p.pid, p.pgid]) {
    if (n !== undefined && (!Number.isInteger(n) || (n as number) <= 0)) return false;
  }
  // A pgid without its pid is meaningless bookkeeping — reject it rather than
  // silently carrying an unsignalable half-record.
  if (p.pgid !== undefined && p.pid === undefined) return false;
  return true;
}

function isValidSocketId(v: unknown): v is SocketId {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<SocketId>;
  return (
    typeof s.path === "string" &&
    s.path.length > 0 &&
    typeof s.dev === "number" &&
    typeof s.ino === "number"
  );
}

/**
 * Parse a manifest; "corrupt" when the file exists but cannot be trusted.
 * Validation is STRUCTURAL and total: gen must agree with the filename, phase
 * must be a known value, every recorded process identity and socket record
 * must be well-formed. A malformed child identity makes the WHOLE manifest
 * corrupt (⇒ every consumer fails closed) — it must never read as "dead".
 */
export function readManifest(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  gen: number,
): GenerationManifest | "corrupt" | null {
  const file = manifestFile(paths, gen);
  if (!deps.fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(deps.fs.readFileSync(file)) as GenerationManifest;
    if (parsed.gen !== gen) return "corrupt"; // filename ↔ content disagreement
    if (parsed.phase !== "starting" && parsed.phase !== "running" && parsed.phase !== "stopping") {
      return "corrupt";
    }
    if (typeof parsed.startedAt !== "number") return "corrupt";
    if (!isValidProcId(parsed.wrapper)) return "corrupt";
    if (parsed.next !== undefined && !isValidProcId(parsed.next)) return "corrupt";
    if (parsed.terminal !== undefined && !isValidProcId(parsed.terminal)) return "corrupt";
    if (!parsed.sockets || typeof parsed.sockets !== "object") return "corrupt";
    if (parsed.sockets.next !== undefined && !isValidSocketId(parsed.sockets.next)) return "corrupt";
    if (parsed.sockets.terminal !== undefined && !isValidSocketId(parsed.sockets.terminal)) {
      return "corrupt";
    }
    if (parsed.spawning !== undefined) {
      if (!Array.isArray(parsed.spawning)) return "corrupt";
      if (!parsed.spawning.every(isValidSpawnPlaceholder)) return "corrupt";
    }
    if (parsed.stoppingAt !== undefined && typeof parsed.stoppingAt !== "number") return "corrupt";
    if (parsed.commands !== undefined) {
      if (!parsed.commands || typeof parsed.commands !== "object") return "corrupt";
      for (const slot of ["next", "terminal"] as const) {
        const cmd = parsed.commands[slot];
        if (cmd === undefined) continue;
        if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((a) => typeof a === "string")) {
          return "corrupt";
        }
      }
    }
    return parsed;
  } catch (err) {
    // An fs failure is evidence-UNAVAILABLE, not evidence of corruption:
    // callers repair "corrupt" (force-reclaim) but must fail closed on an
    // unreadable disk.
    if (err instanceof SupervisionEvidenceError) throw err;
    return "corrupt";
  }
}

/** Placeholders with no recorded pid — spawn outcome unknown ⇒ fail closed [F4]. */
export function unresolvedPlaceholders(m: GenerationManifest): SpawnPlaceholder[] {
  return (m.spawning ?? []).filter((p) => p.pid === undefined);
}

/** Every socket path a generation CLAIMS, including in-flight spawns [F4]. */
export function claimedSocketPaths(m: GenerationManifest): string[] {
  const paths: string[] = [];
  for (const sock of [m.sockets?.next, m.sockets?.terminal]) {
    if (sock) paths.push(sock.path);
  }
  for (const p of m.spawning ?? []) paths.push(p.socketPath);
  return paths;
}

/**
 * Every NON-ARCHIVED manifest, corrupt ones reported separately. Generation
 * evidence must never be limited to the POINTED manifest: a `starting`
 * generation is real (live wrapper + detached children) for up to minutes
 * before the pointer flips, and ignoring it would let stop/deploy proceed
 * over live processes and let reclaim treat their sockets as orphans.
 */
export function readAllLiveManifests(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
): { manifests: GenerationManifest[]; corruptGens: number[] } {
  const manifests: GenerationManifest[] = [];
  const corruptGens: number[] = [];
  for (const gen of listGenerations(deps, paths)) {
    const m = readManifest(deps, paths, gen);
    if (m === "corrupt") corruptGens.push(gen);
    else if (m) manifests.push(m);
  }
  return { manifests, corruptGens };
}

/**
 * Is every process of this manifest verifiably gone? Children require leader
 * DEAD + group EMPTY (procEntryFullyDead — detached fresh pgroups). The
 * wrapper entry requires leader-dead only: its pgroup may be shared with an
 * unrelated long-lived parent (a shell/launchd context), so group occupancy
 * there is not evidence of a surviving server.
 */
export function manifestFullyDead(deps: SupervisionDeps, m: GenerationManifest): boolean {
  if (procIdentityState(deps, m.wrapper) !== "dead") return false;
  for (const child of [m.next, m.terminal]) {
    if (child && !procEntryFullyDead(deps, child)) return false;
  }
  // In-flight spawns [F4]: a placeholder with no pid means we cannot know
  // whether a process exists at all — never "dead". One WITH a pid is dead
  // only when the pid is gone AND its (detached) group is empty.
  for (const p of m.spawning ?? []) {
    if (p.pid === undefined) return false;
    if (isPidAliveDeps(deps, p.pid)) return false;
    if (p.pgid !== undefined && pgroupOccupied(deps, p.pgid)) return false;
  }
  return true;
}

/** Write a manifest atomically (temp+rename — never a partial file) [R3]. */
export function writeManifest(deps: SupervisionDeps, paths: SupervisionPaths, m: GenerationManifest): void {
  writeAtomic(deps, manifestFile(paths, m.gen), JSON.stringify(m, null, 2));
}

/**
 * Declare an in-flight spawn BEFORE calling spawn() [F4]. The placeholder (and
 * therefore the socket path the child will claim) is on disk before a process
 * can possibly exist, so no SIGKILL window can leave a live child invisible to
 * shutdown, reclaim or the orphan-socket sweep.
 */
export function beginChildSpawn(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  m: GenerationManifest,
  child: ChildSlot,
  socketPath: string,
  /** The argv about to be exec'd — the anchor for later command identification. */
  cmd: string[],
): void {
  m.spawning = [...(m.spawning ?? []).filter((p) => p.child !== child), { child, socketPath }];
  m.commands = { ...(m.commands ?? {}), [child]: cmd };
  writeManifest(deps, paths, m);
}

/**
 * Record a just-spawned child's pid SYNCHRONOUSLY, before anything else [F4].
 * Children are spawned detached, so pgid == pid. This is the narrowest
 * possible window: from here the process is signalable and attributable even
 * if its full identity is never captured.
 */
export function recordChildSpawnPid(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  m: GenerationManifest,
  child: ChildSlot,
  pid: number,
): void {
  m.spawning = (m.spawning ?? []).map((p) => (p.child === child ? { ...p, pid, pgid: pid } : p));
  writeManifest(deps, paths, m);
}

/**
 * Promote an in-flight spawn to a fully identified child entry: the
 * placeholder is dropped in the SAME atomic write that records the ProcId, so
 * the child is never absent from the manifest for an instant.
 */
export function completeChildSpawn(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  m: GenerationManifest,
  child: ChildSlot,
  id: ProcId,
): void {
  m[child] = id;
  m.spawning = (m.spawning ?? []).filter((p) => p.child !== child);
  writeManifest(deps, paths, m);
}

/**
 * Drop an in-flight spawn whose outcome is definitively known to be "no
 * process" (spawn() reported no pid) or whose process has been killed and
 * verified gone. Never call this while the outcome is unknown.
 */
export function abandonChildSpawn(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  m: GenerationManifest,
  child: ChildSlot,
): void {
  m.spawning = (m.spawning ?? []).filter((p) => p.child !== child);
  writeManifest(deps, paths, m);
}

/**
 * Update only the phase field (temp+rename of the whole document). Entering
 * `stopping` also stamps `stoppingAt` — the upper bound that makes
 * process-group attribution possible later (a lower bound alone cannot
 * distinguish our descendants from a recycled pgid's later group).
 */
export function updateManifestPhase(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  gen: number,
  phase: GenerationManifest["phase"],
): void {
  const m = readManifest(deps, paths, gen);
  if (m === null || m === "corrupt") return;
  m.phase = phase;
  if (phase === "stopping" && m.stoppingAt === undefined) m.stoppingAt = deps.now();
  writeManifest(deps, paths, m);
}

/**
 * Enumerate a directory, converting ANY non-ENOENT failure into a
 * SupervisionEvidenceError. "The directory is missing" is data; "the directory
 * could not be read" is NOT "no generations" — swallowing it would let reclaim
 * build an empty claim set and unlink the LIVE generation's sockets.
 */
function readdirOrFailClosed(deps: SupervisionDeps, dir: string): string[] {
  try {
    return deps.fs.readdirSync(dir);
  } catch (err) {
    if (err instanceof SupervisionEvidenceError) throw err;
    throw new SupervisionEvidenceError(
      `cannot enumerate ${dir}: ${String(err)} — generation evidence unavailable; failing closed`,
    );
  }
}

/** Non-archived generation numbers present on disk, ascending. */
export function listGenerations(deps: SupervisionDeps, paths: SupervisionPaths): number[] {
  return readdirOrFailClosed(deps, paths.generationsDir)
    .filter((name) => /^\d+\.json$/.test(name))
    .map((name) => parseInt(basename(name, ".json"), 10))
    .sort((a, b) => a - b);
}

export function readCurrentGen(deps: SupervisionDeps, paths: SupervisionPaths): number | null {
  if (!deps.fs.existsSync(paths.currentGenerationFile)) return null;
  const raw = deps.fs.readFileSync(paths.currentGenerationFile).trim();
  const gen = parseInt(raw, 10);
  return Number.isInteger(gen) && gen > 0 ? gen : null;
}

/**
 * Flip the current-generation pointer (one-line file, atomic rename). Callers
 * flip ONLY after both children + sockets are recorded in the manifest [R3].
 */
export function flipCurrentGen(deps: SupervisionDeps, paths: SupervisionPaths, gen: number): void {
  writeAtomic(deps, paths.currentGenerationFile, `${gen}\n`);
}

/**
 * Next monotonic generation number: max of the pointer, every on-disk manifest
 * (live + archived) AND the generation LEDGER, plus one. The ledger matters
 * because the wrapper appends its generation entry BEFORE writing the
 * manifest: a wrapper that dies in between would otherwise leave no on-disk
 * trace of that number and the next wrapper would REUSE it, so two distinct
 * generations would share a manifest filename and identity.
 */
export function nextGenNumber(deps: SupervisionDeps, paths: SupervisionPaths): number {
  const current = readCurrentGen(deps, paths) ?? 0;
  const onDisk = listGenerations(deps, paths);
  const archived = readdirOrFailClosed(deps, paths.generationsArchiveDir)
    .filter((name) => /^\d+\.json$/.test(name))
    .map((name) => parseInt(basename(name, ".json"), 10));
  return Math.max(current, ...onDisk, ...archived, maxGenerationLedgerNumber(deps, paths), 0) + 1;
}

/** Retire a manifest whose processes are verified dead [R3]. */
export function archiveManifest(deps: SupervisionDeps, paths: SupervisionPaths, gen: number): void {
  const from = manifestFile(paths, gen);
  if (!deps.fs.existsSync(from)) return;
  deps.fs.mkdirSync(paths.generationsArchiveDir);
  deps.fs.renameSync(from, join(paths.generationsArchiveDir, `${gen}.json`));
}

// ─────────────────────────────────────────────────────────────────────────────
// Socket ownership [R2]
// ─────────────────────────────────────────────────────────────────────────────

/** Record a bound socket's identity (dev/ino) for the manifest. */
export function captureSocketId(deps: SupervisionDeps, path: string): SocketId | null {
  const st = deps.fs.lstatSync(path);
  if (!st || !st.isSocket) return null;
  return { path, dev: st.dev, ino: st.ino };
}

/**
 * THE UNLINK RULE [R2]: compare lstat dev/ino against YOUR OWN manifest
 * record — match ⇒ yours, unlink allowed; mismatch or unknown ⇒ never unlink.
 * Returns true only when the path was verified-owned and unlinked.
 */
export function unlinkOwnedSocket(
  deps: SupervisionDeps,
  path: string,
  recorded: SocketId | undefined,
): boolean {
  if (!recorded) return false; // unknown ⇒ never unlink.
  const st = deps.fs.lstatSync(path);
  if (!st) return false; // already gone.
  if (st.dev !== recorded.dev || st.ino !== recorded.ino) return false; // not ours.
  try {
    deps.fs.unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reclaim (pre-spawn / recovery) — §3.3
// ─────────────────────────────────────────────────────────────────────────────

export interface ReclaimResult {
  killedPgids: number[];
  unlinkedSockets: string[];
  archivedGens: number[];
  corruptGens: number[];
  /**
   * Generations that could NOT be resolved: processes (or an in-flight spawn)
   * that are neither provably dead nor safely killable. Callers that are about
   * to spawn MUST fail on a non-empty list — starting over survivors is either
   * a bind crash-loop or two live generations serving one socket.
   */
  unresolvedGens: Array<{ gen: number; detail: string }>;
}

/** SIGKILL → "verifiably gone" settle budget before a generation is judged. */
const RECLAIM_KILL_SETTLE_MS = 2_000;

/**
 * Is any live process holding this unix socket path? Used as the LAST guard
 * before destructive cleanup that is not backed by manifest proof (operator
 * force-reclaim, and the pid-less-placeholder retirement).
 *
 * Three outcomes, and only "free" may authorize an unlink:
 *   - "free": the path is gone, or lsof reports no holder;
 *   - "held": at least one live process has it open (pids in `detail`);
 *   - "unknown": lsof could not be run or its output could not be trusted —
 *     never treated as free.
 *
 * lsof output stays DIAGNOSTIC for every non-destructive decision [F6]; this
 * is the one place its answer gates an action, and it gates it conservatively.
 */
export function socketHolder(
  deps: SupervisionDeps,
  path: string,
): { state: "free" | "held" | "unknown"; detail: string } {
  const st = deps.fs.lstatSync(path);
  if (!st || !st.isSocket) return { state: "free", detail: `${path} is not a socket on disk` };
  const res = deps.exec(["lsof", "-t", "-U", "-a", "--", path]);
  // lsof exits 1 with no output when nothing matches — the "free" case.
  if (res.exitCode === 1 && res.stdout.trim() === "") {
    return { state: "free", detail: `${path} has no live holder (lsof)` };
  }
  if (res.exitCode !== 0 && res.exitCode !== 1) {
    return { state: "unknown", detail: `lsof failed for ${path} (exit ${res.exitCode})` };
  }
  const pids = res.stdout
    .split("\n")
    .map((l) => parseInt(l.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (pids.length === 0) return { state: "free", detail: `${path} has no live holder (lsof)` };
  return { state: "held", detail: `${path} held by pid(s) ${pids.join(", ")}` };
}

/**
 * Does a running process's command line plausibly belong to the child we
 * recorded at spawn time? The recorded argv is what the WRAPPER exec'd
 * (`bun run tsx src/server/index.ts`); the surviving descendant we may need to
 * kill is typically an inner process of that same tree, whose argv[0] differs
 * (`node …/tsx …`) while the distinctive script path is preserved.
 *
 * So the test is: every path-like token of the recorded argv that survives
 * into descendants — script paths (`src/server/index.ts`,
 * `scripts/standalone-server.js`) — must appear in the member's command line.
 * Falls back to the basename of argv[0] when the recorded argv has no script
 * token. An unrelated process that merely inherited a recycled pgid will not
 * carry our script path, which is exactly the identification a timestamp
 * window cannot provide.
 */
export function commandMatchesRecorded(memberCommand: string, recordedArgv: string[]): boolean {
  const cmd = memberCommand.trim();
  if (cmd.length === 0) return false;
  const scriptTokens = recordedArgv.filter((a) => /\.(ts|js|mjs|cjs)$/.test(a) || a.includes("/"));
  if (scriptTokens.length > 0) {
    return scriptTokens.some((t) => cmd.includes(t));
  }
  const argv0 = recordedArgv[0];
  if (!argv0) return false;
  const base = argv0.split("/").pop() as string;
  return cmd.includes(base);
}

export interface GroupAttributionInput {
  pgid: number;
  /** Lower bound: the generation's startedAt (epoch ms). */
  startedAtMs: number;
  /**
   * Upper bound: when this generation stopped being current (epoch ms), or
   * null when unknown. REQUIRED for attribution — see below.
   */
  endedAtMs: number | null;
  /** The argv this child was spawned with, or null when unrecorded. */
  expectedArgv: string[] | null;
  label: string;
}

/**
 * Attribute the members of an occupied process group to a generation, then —
 * and ONLY then — kill it [F4].
 *
 * The recorded leader is dead, so identity verification is impossible. A
 * timestamp LOWER bound alone is NOT proof of descent: when a pgid is recycled
 * to a LATER, unrelated group, every member of that group also "started after
 * the generation". Signalling on that basis would SIGKILL an unrelated process
 * group — strictly worse than leaving the survivor alone. Attribution
 * therefore requires all three of:
 *
 *   1. a lower bound — the member started at or after the generation did;
 *   2. an UPPER bound — the member started before the generation stopped being
 *      current (manifest.stoppingAt). With no recorded upper bound there is
 *      nothing to separate our descendants from a later group, so every member
 *      is unattributable and we signal nothing;
 *   3. POSITIVE command identity — the member's command line carries the
 *      script path we recorded for that child slot at spawn time.
 *
 * Any member failing any of these makes the WHOLE group unattributable: we
 * signal nothing, fail closed, and report the exact pids and command lines so
 * an operator can act. Only a group whose every member is positively
 * identified is signalled.
 */
export async function attributeAndKillGroup(
  deps: SupervisionDeps,
  input: GroupAttributionInput,
): Promise<{ killed: boolean; attributed: boolean; detail: string }> {
  const { pgid, startedAtMs, endedAtMs, expectedArgv, label } = input;
  const res = deps.exec(["pgrep", "-g", String(pgid)]);
  // pgrep exit 1 == no matches: the group emptied between the occupancy probe
  // and here, which is the success condition. Any other non-zero exit is an
  // enumeration FAILURE — unattributable, fail closed.
  if (res.exitCode === 1) {
    return { killed: false, attributed: true, detail: `${label}: group ${pgid} already empty` };
  }
  if (res.exitCode !== 0) {
    return {
      killed: false,
      attributed: false,
      detail: `${label}: cannot enumerate group ${pgid} (pgrep exit ${res.exitCode}) — unattributable`,
    };
  }
  const members = res.stdout
    .split("\n")
    .map((l) => parseInt(l.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (members.length === 0) {
    return { killed: false, attributed: true, detail: `${label}: group ${pgid} already empty` };
  }

  const describe = (pid: number): string => {
    const ps = deps.exec(["ps", "-o", "command=", "-p", String(pid)]);
    const cmd = ps.exitCode === 0 ? ps.stdout.trim().split("\n")[0]?.trim() : "";
    return cmd ? `${pid} (${cmd})` : `${pid} (command unreadable)`;
  };
  const refuse = (reason: string): { killed: false; attributed: false; detail: string } => ({
    killed: false,
    attributed: false,
    detail:
      `${label}: refusing to signal group ${pgid} — ${reason}. Members: ` +
      `${members.map(describe).join("; ")}`,
  });

  if (endedAtMs === null) {
    return refuse(
      "no upper bound on this generation's lifetime (manifest has no stoppingAt), so a recycled " +
        "pgid belonging to a LATER group cannot be ruled out",
    );
  }
  if (!expectedArgv || expectedArgv.length === 0) {
    return refuse("no spawn command recorded for this child, so members cannot be positively identified");
  }

  const startedAtNs = BigInt(Math.floor(startedAtMs)) * BigInt(1_000_000);
  const endedAtNs = BigInt(Math.floor(endedAtMs)) * BigInt(1_000_000);
  for (const pid of members) {
    const startNs = deps.procStartTimeNs(pid);
    // A missing OR non-decimal start time is equally unattributable — parse
    // defensively rather than letting BigInt() throw out of a cleanup path.
    if (startNs === null || !/^\d+$/.test(startNs)) {
      return refuse(`member ${pid} start time is unreadable`);
    }
    if (BigInt(startNs) < startedAtNs) {
      return refuse(`member ${pid} predates the generation (pgid recycled to an unrelated group)`);
    }
    if (BigInt(startNs) > endedAtNs) {
      return refuse(
        `member ${pid} started AFTER the generation stopped being current — it belongs to a later, ` +
          "unrelated group that inherited this pgid",
      );
    }
    const ps = deps.exec(["ps", "-o", "command=", "-p", String(pid)]);
    if (ps.exitCode !== 0) {
      return refuse(`member ${pid} command line is unreadable (ps exit ${ps.exitCode})`);
    }
    const memberCmd = ps.stdout.trim().split("\n")[0] ?? "";
    if (!commandMatchesRecorded(memberCmd, expectedArgv)) {
      return refuse(
        `member ${pid} command "${memberCmd.trim()}" does not match the recorded spawn command ` +
          `"${expectedArgv.join(" ")}"`,
      );
    }
  }

  signalPgid(deps, pgid, "SIGTERM");
  const deadline = deps.now() + RECLAIM_TERM_WAIT_MS;
  while (deps.now() < deadline && pgroupOccupied(deps, pgid)) {
    await deps.sleep(200);
  }
  if (pgroupOccupied(deps, pgid)) signalPgid(deps, pgid, "SIGKILL");
  const killDeadline = deps.now() + RECLAIM_KILL_SETTLE_MS;
  while (deps.now() < killDeadline && pgroupOccupied(deps, pgid)) {
    await deps.sleep(100);
  }
  return pgroupOccupied(deps, pgid)
    ? { killed: false, attributed: true, detail: `${label}: group ${pgid} survived SIGKILL` }
    : {
        killed: true,
        attributed: true,
        detail: `${label}: group ${pgid} (members ${members.join(",")}) positively attributed and terminated`,
      };
}

/**
 * Reclaim everything owned by NON-current generations:
 *   1. identity-verify each recorded process; verified-alive ⇒ SIGTERM its
 *      recorded PGID, wait ≤5s, SIGKILL;
 *   2. unlink socket paths whose live dev/ino matches that generation's
 *      manifest record;
 *   3. archive manifests whose processes are all verified dead;
 *   4. finally, unlink well-known socket paths that lstat as sockets but are
 *      claimed by NO manifest (orphans with no verifiable holder).
 * `lsof -U` output is logged as DIAGNOSTICS ONLY — never parsed for decisions
 * [F6]. A corrupt manifest fails CLOSED (CorruptManifestError) unless `force`
 * (the operator-consented doctor-supervision --force-reclaim path) [R3].
 */
export async function reclaimPriorGenerations(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  opts: { currentGen: number | null; force?: boolean },
): Promise<ReclaimResult> {
  const result: ReclaimResult = {
    killedPgids: [],
    unlinkedSockets: [],
    archivedGens: [],
    corruptGens: [],
    unresolvedGens: [],
  };

  // The current-generation POINTER must resolve to manifest evidence (live or
  // archived). A dangling pointer means processes may be alive with NO
  // manifest to claim their sockets — reclaiming would unlink them as
  // "orphans", recreating the outage class. Fail closed unless the operator
  // consented via --force-reclaim [R3].
  const pointer = currentGenerationState(deps, paths);
  if (pointer.state === "unverifiable" && !opts.force) {
    throw new CorruptManifestError(pointer.gen ?? -1, manifestFile(paths, pointer.gen ?? -1));
  }

  const gens = listGenerations(deps, paths);

  // Load every manifest first so corruption fails closed BEFORE any signal.
  const manifests = new Map<number, GenerationManifest>();
  for (const gen of gens) {
    const m = readManifest(deps, paths, gen);
    if (m === "corrupt") {
      if (!opts.force) throw new CorruptManifestError(gen, manifestFile(paths, gen));
      result.corruptGens.push(gen);
      continue;
    }
    if (m) manifests.set(gen, m);
  }

  const prior = [...manifests.values()].filter((m) => m.gen !== opts.currentGen);

  // 1. SIGTERM verified-alive prior-generation processes.
  //    - CHILDREN by their recorded PGID: they are spawned detached, so the
  //      group is exactly their own tree [F5].
  //    - the WRAPPER by LEADER PID ONLY: its group may be shared with the
  //      invoking shell, and group-signalling it would kill the operator's
  //      shell and the very command running this reclaim. Its own SIGTERM
  //      handler stops its children.
  const terminatedChildren: ProcId[] = [];
  const terminatedWrappers: ProcId[] = [];
  for (const m of prior) {
    if (verifyProcIdentity(deps, m.wrapper)) {
      signalPid(deps, m.wrapper.pid, "SIGTERM");
      terminatedWrappers.push(m.wrapper);
    }
    for (const id of [m.next, m.terminal]) {
      if (id && verifyProcIdentity(deps, id)) {
        signalPgid(deps, id.pgid, "SIGTERM");
        terminatedChildren.push(id);
        result.killedPgids.push(id.pgid);
      }
    }
  }

  // Bounded wait, then SIGKILL survivors (identity-verified — never a
  // recycled pid). Wrappers stay leader-only; children escalate by group.
  const terminated = [...terminatedWrappers, ...terminatedChildren];
  if (terminated.length > 0) {
    const deadline = deps.now() + RECLAIM_TERM_WAIT_MS;
    while (deps.now() < deadline && terminated.some((id) => verifyProcIdentity(deps, id))) {
      await deps.sleep(200);
    }
    for (const id of terminatedWrappers) {
      if (verifyProcIdentity(deps, id)) signalPid(deps, id.pid, "SIGKILL");
    }
    for (const id of terminatedChildren) {
      if (verifyProcIdentity(deps, id)) signalPgid(deps, id.pgid, "SIGKILL");
    }
    // Let the kills land before anything judges the generation dead — without
    // this settle window a just-SIGKILLed child reads as "unresolved" and
    // fails the very start that is cleaning up after it.
    const settleDeadline = deps.now() + RECLAIM_KILL_SETTLE_MS;
    while (
      deps.now() < settleDeadline &&
      (terminatedChildren.some((id) => !procEntryFullyDead(deps, id)) ||
        terminatedWrappers.some((id) => procIdentityState(deps, id) !== "dead"))
    ) {
      await deps.sleep(100);
    }
  }

  // 1b. Dead leader, LIVE group: `bun run tsx` can die while the real server
  // grandchild lives on holding the socket. The recorded identity can no
  // longer be verified, so members are attributed by start time and only then
  // killed [F4]; an unattributable group is left alone and fails closed.
  for (const m of prior) {
    for (const slot of ["next", "terminal"] as const) {
      const id = m[slot];
      if (!id) continue;
      if (procIdentityState(deps, id) !== "dead") continue;
      if (!pgroupOccupied(deps, id.pgid)) continue;
      const outcome = await attributeAndKillGroup(deps, {
        pgid: id.pgid,
        startedAtMs: m.startedAt,
        endedAtMs: m.stoppingAt ?? null,
        expectedArgv: m.commands?.[slot] ?? null,
        label: `gen ${m.gen} child ${slot} ${id.pid}`,
      });
      deps.log(`reclaim: ${outcome.detail}`);
      if (outcome.killed) result.killedPgids.push(id.pgid);
      if (!outcome.attributed) notifyEscalation(deps, paths, `reclaim: ${outcome.detail}`);
    }
    // In-flight spawns recorded at spawn time but never identity-captured:
    // same treatment, anchored on the same generation bounds [F4].
    for (const p of m.spawning ?? []) {
      if (p.pid === undefined || p.pgid === undefined) continue;
      if (isPidAliveDeps(deps, p.pid) || pgroupOccupied(deps, p.pgid)) {
        const outcome = await attributeAndKillGroup(deps, {
          pgid: p.pgid,
          startedAtMs: m.startedAt,
          endedAtMs: m.stoppingAt ?? null,
          expectedArgv: m.commands?.[p.child] ?? null,
          label: `gen ${m.gen} in-flight ${p.child} ${p.pid}`,
        });
        deps.log(`reclaim: ${outcome.detail}`);
        if (outcome.killed) result.killedPgids.push(p.pgid);
        if (!outcome.attributed) notifyEscalation(deps, paths, `reclaim: ${outcome.detail}`);
      }
    }
  }

  // 2+3. Per prior generation: sockets may be unlinked and the manifest
  // archived ONLY once the generation is verifiably ALL-gone —
  // manifestFullyDead: leaders DEAD (quad-state; "identity-unavailable" is
  // NOT dead) and child pgroups EMPTY (a detached grandchild outliving its
  // dead `bun run tsx` leader still owns the socket). Anything less leaves
  // both in place: unlinking would recreate the exact outage this design
  // closes, and archiving would hide the survivor from the next reclaim.
  for (const m of prior) {
    if (!manifestFullyDead(deps, m)) {
      const states = [m.wrapper, m.next, m.terminal]
        .filter((id): id is ProcId => Boolean(id))
        .map((id) => `${id.pid}:${procIdentityState(deps, id)}(pgid ${id.pgid}${pgroupOccupied(deps, id.pgid) ? " occupied" : ""})`);
      for (const p of m.spawning ?? []) {
        states.push(
          p.pid === undefined
            ? `in-flight ${p.child}:SPAWN-OUTCOME-UNKNOWN(socket ${p.socketPath})`
            : `in-flight ${p.child} ${p.pid}:${isPidAliveDeps(deps, p.pid) ? "alive" : "dead"}`,
        );
      }
      const detail = states.join(", ");

      // NO AUTOMATIC RECOVERY for a pid-less spawn placeholder — deliberately.
      //
      // It is tempting to retire one when the wrapper is provably dead and
      // `lsof` shows no holder on the claimed socket. That reasoning is WRONG,
      // because of the BIND WINDOW: the wrapper writes the placeholder, spawn()
      // succeeds, the child has not bound its socket YET, the wrapper dies
      // before recording the pid. lsof truthfully reports "free" — and the
      // child binds moments later, now with its generation archived and
      // another generation admitted. Two live generations on one socket path
      // is the exact outage this design exists to prevent.
      //
      // Without a recorded pid there is no sound automatic test, so this stays
      // unresolved and keeps blocking starts. That is correct fail-closed
      // behavior, and `doctor-supervision --force-reclaim` is the (explicit,
      // human-consented) recovery path.
      deps.log(
        `reclaim: generation ${m.gen} is not verifiably dead (${detail}) — ` +
          `leaving its manifest and sockets untouched; operator attention required`,
      );
      // Surfaced to callers: a wrapper must NEVER spawn over this [F4].
      result.unresolvedGens.push({ gen: m.gen, detail });
      continue;
    }
    for (const sock of [m.sockets?.next, m.sockets?.terminal]) {
      if (sock && unlinkOwnedSocket(deps, sock.path, sock)) {
        result.unlinkedSockets.push(sock.path);
      }
    }
    archiveManifest(deps, paths, m.gen);
    result.archivedGens.push(m.gen);
  }

  // 4. Orphan sockets: a path that lstats as a socket but matches NO manifest
  // claim (current included) has no verifiable holder — reclaim it. Log lsof
  // diagnostics first (informational only [F6]).
  //
  // Claims come in two forms. A dev/ino claim is exact. A PATH claim covers
  // in-flight spawns [F4]: a child that bound its socket between our lstat and
  // its manifest record has no dev/ino on file, so its path must be off-limits
  // — unlinking it is precisely the outage this design exists to prevent.
  const claimed = new Set<string>();
  const claimedPaths = new Set<string>();
  for (const m of manifests.values()) {
    for (const sock of [m.sockets?.next, m.sockets?.terminal]) {
      if (sock) claimed.add(`${sock.dev}:${sock.ino}`);
    }
    for (const p of m.spawning ?? []) claimedPaths.add(p.socketPath);
  }
  for (const path of [paths.nextSocket, paths.terminalSocket]) {
    const st = deps.fs.lstatSync(path);
    if (!st || !st.isSocket) continue;
    if (claimed.has(`${st.dev}:${st.ino}`)) continue;
    if (claimedPaths.has(path)) {
      deps.log(`orphan-socket sweep: ${path} is claimed by an in-flight spawn; leaving it in place [F4]`);
      continue;
    }
    const lsof = deps.exec(["lsof", "-U", "-a", "--", path]);
    deps.log(`orphan socket ${path} (no manifest claim); lsof -U diagnostics:\n${lsof.stdout.trim()}`);
    try {
      deps.fs.unlinkSync(path);
      result.unlinkedSockets.push(path);
    } catch {
      // Best-effort; the wrapper's bind will surface a real conflict.
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy-lock liveness (shared parsing: bare-PID + legacy-JSON, EPERM-is-alive)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The deploy.lock holder pid: null = no lock file (no deploy ever ran);
 * "unreadable" = the file EXISTS but its content cannot be read/parsed —
 * abnormal (the flock engine guarantees parseable content at all times), so
 * liveness readers must FAIL CLOSED on it.
 */
export function deployLockHolderPid(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
): number | "unreadable" | null {
  if (!deps.fs.existsSync(paths.deployLock)) return null;
  let raw = "";
  try {
    raw = deps.fs.readFileSync(paths.deployLock);
  } catch {
    return "unreadable";
  }
  const parsed = parseLockContent(raw);
  return parsed.pid === null ? "unreadable" : parsed.pid;
}

/**
 * Is a LIVE deploy holding deploy.lock? Actuators refuse while true [F11].
 * Unreadable/unparsable lock content counts as LIVE (fail closed) — the
 * normal states are "no file" and "a parseable pid" (dead pid ⇒ not live).
 */
export function deployLockLive(deps: SupervisionDeps, paths: SupervisionPaths): boolean {
  const holder = deployLockHolderPid(deps, paths);
  if (holder === null) return false;
  if (holder === "unreadable") return true;
  return isPidAliveDeps(deps, holder);
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy restart authorization — single-use nonce [F11]
//
// THREAT MODEL, stated honestly: deploy.ts, rdv.ts and every agent shell run as
// the SAME uid, so nothing here is unforgeable — a determined same-uid process
// can read the token file exactly like the intended child can. That is not the
// hazard being closed. The hazard is ACCIDENTAL bypass: an agent or human
// innocently running `rdv start prod` while a job-absent deploy holds the
// deploy lock, which would start a foreground stack over a half-migrated tree.
// A random single-use token that only the deploy's own spawned child is GIVEN
// makes that accident impossible, while an environment variable compared
// against the world-readable pid in deploy.lock did not (any caller could set
// it after reading the lock).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mint a fresh restart token, persist it 0600, and return it for the child's
 * env. The old file is UNLINKED first: `writeFileSync(..., {mode})` applies
 * the mode only when it creates the file, so writing over an existing token
 * would silently keep whatever permissions that file already had — and the
 * "0600" in this comment would be a claim the code does not make good on.
 * Unlinking also invalidates any previous token in the same step.
 */
export function issueDeployRestartToken(deps: SupervisionDeps, paths: SupervisionPaths): string {
  const token = `${Math.floor(deps.now())}-${Math.floor(Math.random() * 1e12).toString(36)}-${Math.floor(
    Math.random() * 1e12,
  ).toString(36)}`;
  deps.fs.mkdirSync(dirname(paths.deployRestartToken));
  clearDeployRestartToken(deps, paths);
  deps.fs.writeFileSync(paths.deployRestartToken, `${token}\n`, 0o600);
  return token;
}

/**
 * Authorize a foreground start against the token file, consuming it on a match
 * (single use). A non-match NEVER consumes the file — otherwise any stray
 * `rdv start prod` would burn the deploy's own authorization and strand it.
 */
export function consumeDeployRestartToken(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  presented: string | undefined,
): boolean {
  if (!presented) return false;
  if (!deps.fs.existsSync(paths.deployRestartToken)) return false;
  let recorded: string;
  try {
    recorded = deps.fs.readFileSync(paths.deployRestartToken).trim();
  } catch {
    return false;
  }
  if (recorded.length === 0 || recorded !== presented.trim()) return false;
  try {
    deps.fs.unlinkSync(paths.deployRestartToken);
  } catch (err) {
    // The token could not be invalidated — refuse rather than leave a reusable
    // authorization behind.
    deps.log(`deploy restart token could not be consumed (${String(err)}); refusing authorization`);
    return false;
  }
  return true;
}

/** Drop any unconsumed token (deploy finished / a new one is about to be minted). */
export function clearDeployRestartToken(deps: SupervisionDeps, paths: SupervisionPaths): void {
  try {
    if (deps.fs.existsSync(paths.deployRestartToken)) deps.fs.unlinkSync(paths.deployRestartToken);
  } catch (err) {
    deps.log(`could not clear deploy restart token: ${String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Locks (§3.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Acquire the control lock, retrying with backoff up to the 30s budget, then
 * aborting with the holder's pid (informational content) — a contender never
 * partially proceeds [R8].
 */
export async function acquireControlLock(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  timeoutMs: number = CONTROL_LOCK_TIMEOUT_MS,
): Promise<PureFlockHandle | null> {
  deps.fs.mkdirSync(paths.runDir);
  const deadline = deps.now() + timeoutMs;
  let backoff = 250;
  for (;;) {
    const handle = await deps.tryFlock(paths.controlLock);
    if (handle) return handle;
    if (deps.now() >= deadline) {
      let holder = "unknown";
      try {
        holder = String(parseLockContent(deps.fs.readFileSync(paths.controlLock)).pid ?? "unknown");
      } catch {
        // informational only
      }
      deps.log(`control lock busy (holder pid ${holder}); aborting after ${timeoutMs}ms`);
      return null;
    }
    await deps.sleep(backoff);
    backoff = Math.min(backoff * 2, 2_000);
  }
}

/** Foreground lock — held by the job-absent foreground wrapper for its lifetime. */
export async function acquireForegroundLock(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
): Promise<PureFlockHandle | null> {
  deps.fs.mkdirSync(paths.runDir);
  return deps.tryFlock(paths.foregroundLock);
}

// ─────────────────────────────────────────────────────────────────────────────
// Delegation decision tables (§3.2) — pure, unit-testable
// ─────────────────────────────────────────────────────────────────────────────

export interface DelegationInput {
  /** argv contained --launchd-child. */
  launchdChildFlag: boolean;
  ppid: number;
  xpcServiceName: string | undefined;
  label: string;
  jobLoaded: boolean | "unknown";
  plistInstalled: boolean;
  desiredState: DesiredStateValue | null;
  deployLockLive: boolean;
  /**
   * The deploy's OWN restart channel [F11]: true only when this invocation
   * presented (and thereby consumed) the single-use token deploy.ts minted for
   * the child it spawned. This is what lets the live deploy's job-absent
   * restart start a foreground wrapper while its own lock is held, while an
   * EXTERNAL `rdv start prod` mid-deploy is refused. See the token section for
   * the (same-uid) threat model.
   */
  foregroundDeployAuthorized: boolean;
}

/** Shown once when launchd started us from a plist that predates the marker. */
export const LEGACY_PLIST_WARNING =
  `legacy ${PROD_LABEL} plist detected (no --launchd-child in ProgramArguments). ` +
  "Supervision is running correctly via launchd provenance; install the canonical plist with " +
  "`bash scripts/install-supervision.sh` at your convenience.";

export type StartDecision =
  | { action: "real-start-launchd"; legacyPlist: boolean }
  | { action: "delegate-kickstart" }
  | { action: "delegate-bootstrap" }
  | { action: "foreground-start" }
  | { action: "fail-closed"; reason: string };

export function decideStartProd(i: DelegationInput): StartDecision {
  // PROVENANCE is the property that matters, and it alone is sufficient:
  // ppid === 1 AND XPC_SERVICE_NAME naming this job means launchd exec'd us.
  // The `--launchd-child` marker is a HINT, not a requirement.
  //
  // Requiring both would brick prod on rollout. The plist installed on a host
  // that has not yet run install-supervision.sh has no marker, so a
  // launchd-started wrapper would fall through to `delegate-kickstart`, probe
  // an unstarted stack as unhealthy, `kickstart -k` its own job, and be
  // re-exec'd with the same argv — an infinite restart loop throttled to every
  // ThrottleInterval, with prod never coming up. That makes merging the code
  // and running the installer independently orderable: both plists work.
  //
  // This does not weaken [R1]. A forged marker WITHOUT provenance still falls
  // through to the delegation/foreground path where the locks live, and an
  // accidental `rdv start prod` from a shell has neither ppid 1 nor a matching
  // XPC_SERVICE_NAME — which is the misinvocation this guard actually exists
  // to catch (deliberate same-uid forgery is out of scope per the adjudicated
  // threat model).
  if (verifyLaunchdProvenance(i.ppid, i.xpcServiceName, i.label)) {
    return { action: "real-start-launchd", legacyPlist: !i.launchdChildFlag };
  }
  // A forged --launchd-child (wrong ppid / XPC_SERVICE_NAME) falls through to
  // the delegation/foreground logic — where the locks live [R1].
  if (i.jobLoaded === "unknown") {
    return {
      action: "fail-closed",
      reason:
        `launchctl state for ${i.label} is unknown (launchctl unavailable/failed). ` +
        `Refusing to guess [F9]. Remediation: verify \`launchctl print gui/$(id -u)/${i.label}\` by hand.`,
    };
  }
  if (i.jobLoaded) return { action: "delegate-kickstart" };
  if (i.plistInstalled) return { action: "delegate-bootstrap" };
  // Job-absent foreground mode is gated on the deploy lock like every other
  // start path [F11]: an external `rdv start prod` during a job-absent
  // deploy's stop→migrate window must not grab the foreground lock and start
  // against the live tree mid-migration. Only the deploy's OWN restart
  // (RDV_DEPLOY_PARENT_PID matching the live lock holder) passes.
  if (i.deployLockLive && !i.foregroundDeployAuthorized) {
    return {
      action: "fail-closed",
      reason:
        "a live deploy holds deploy.lock; refusing a foreground start mid-deploy. " +
        "Retry after the deploy completes (the deploy restarts the servers itself).",
    };
  }
  return { action: "foreground-start" };
}

export type RestartDecision =
  | { action: "delegate-kickstart" }
  | { action: "refuse-deploy-in-progress" }
  | { action: "refuse-desired-stopped" }
  | { action: "foreground-restart" }
  | { action: "fail-closed"; reason: string };

export function decideRestartProd(i: DelegationInput): RestartDecision {
  if (i.jobLoaded === "unknown") {
    return {
      action: "fail-closed",
      reason:
        `launchctl state for ${i.label} is unknown. Refusing to restart blind [F9]. ` +
        `Remediation: verify \`launchctl print gui/$(id -u)/${i.label}\` by hand.`,
    };
  }
  if (i.deployLockLive) return { action: "refuse-deploy-in-progress" };
  if (i.jobLoaded) return { action: "delegate-kickstart" };
  if (i.plistInstalled) {
    if (i.desiredState === "stopped") return { action: "refuse-desired-stopped" };
    return {
      action: "fail-closed",
      reason:
        `${i.label} plist is installed but the job is not loaded and desired state is ` +
        `${i.desiredState ?? "unset"} — not an intentional stop. Refusing to restart blind. ` +
        `Remediation: \`rdv start prod\` (bootstraps the job) or \`rdv doctor-supervision\`.`,
    };
  }
  return { action: "foreground-restart" };
}

export type StopDecision =
  | { action: "bootout" }
  | { action: "foreground-stop" }
  | { action: "fail-closed"; reason: string };

export function decideStopProd(i: DelegationInput): StopDecision {
  if (i.jobLoaded === "unknown") {
    return {
      action: "fail-closed",
      reason:
        `launchctl state for ${i.label} is unknown. Refusing to stop blind [F9]. ` +
        `Remediation: verify \`launchctl print gui/$(id -u)/${i.label}\` by hand.`,
    };
  }
  if (i.jobLoaded) return { action: "bootout" };
  return { action: "foreground-stop" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledgers + escalation [F17, R12]
// ─────────────────────────────────────────────────────────────────────────────

/** Append `<epoch> <actor> <reason>` to a ledger file. */
export function appendLedger(
  deps: SupervisionDeps,
  file: string,
  actor: string,
  reason: string,
): void {
  deps.fs.mkdirSync(dirname(file));
  const epoch = Math.floor(deps.now() / 1000);
  deps.fs.appendFileSync(file, `${epoch} ${actor} ${reason}\n`);
}

/** Epochs of ledger entries with epoch >= sinceEpochSec, ascending. */
export function readLedgerEpochsSince(
  deps: SupervisionDeps,
  file: string,
  sinceEpochSec: number,
): number[] {
  if (!deps.fs.existsSync(file)) return [];
  const epochs: number[] = [];
  for (const line of deps.fs.readFileSync(file).split("\n")) {
    const epoch = parseInt(line.trim(), 10);
    if (Number.isInteger(epoch) && epoch >= sinceEpochSec) epochs.push(epoch);
  }
  return epochs.sort((a, b) => a - b);
}

/** Count ledger entries with epoch >= sinceEpochSec. */
export function countLedgerSince(deps: SupervisionDeps, file: string, sinceEpochSec: number): number {
  return readLedgerEpochsSince(deps, file, sinceEpochSec).length;
}

/** Highest generation number recorded in the generation ledger (0 if none). */
export function maxGenerationLedgerNumber(deps: SupervisionDeps, paths: SupervisionPaths): number {
  if (!deps.fs.existsSync(paths.generationLedger)) return 0;
  let max = 0;
  for (const line of deps.fs.readFileSync(paths.generationLedger).split("\n")) {
    // `<epoch> generation-start <gen>`
    const gen = parseInt(line.trim().split(/\s+/)[2] ?? "", 10);
    if (Number.isInteger(gen) && gen > max) max = gen;
  }
  return max;
}

/**
 * A generation entry this close to a restart entry is that restart's own
 * wrapper start — ONE event, not two [R12]. The window is symmetric because
 * the order differs by path: a launchd actuation records the restart first and
 * the wrapper's generation entry lands moments later, while a FOREGROUND start
 * appends its generation entry at wrapper entry and only records the actuation
 * once the generation has published.
 */
export const LEDGER_DEDUPE_SECONDS = 60;

/**
 * Restart-rate escalation: restart-ledger entries (actuations) PLUS
 * generation-ledger entries (KeepAlive respawns — native crash loops escalate
 * too [R12]) within the window. The two ledgers stay separate files so
 * generation starts never stamp last-restart (no perpetual grace renewal).
 *
 * DEDUPE: an actuation and the wrapper generation it produces are one event.
 * Counting both would let TWO ordinary restarts (2 restart + 2 generation
 * entries = 4) trip a threshold meant to catch three. Each restart entry
 * therefore absorbs at most ONE generation entry that falls inside
 * LEDGER_DEDUPE_SECONDS after it; every other generation entry (a KeepAlive
 * crash respawn nobody asked for) still counts in full.
 */
export function evaluateEscalation(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  opts: { windowSec?: number; threshold?: number } = {},
): { total: number; escalate: boolean } {
  const windowSec = opts.windowSec ?? ESCALATION_WINDOW_SECONDS;
  const threshold = opts.threshold ?? ESCALATION_THRESHOLD;
  const since = Math.floor(deps.now() / 1000) - windowSec;
  const restarts = readLedgerEpochsSince(deps, paths.restartLedger, since);
  const generations = readLedgerEpochsSince(deps, paths.generationLedger, since);

  const absorbed = new Set<number>(); // indices into `generations`
  for (const restartEpoch of restarts) {
    const idx = generations.findIndex(
      (g, i) => !absorbed.has(i) && Math.abs(g - restartEpoch) <= LEDGER_DEDUPE_SECONDS,
    );
    if (idx >= 0) absorbed.add(idx);
  }
  const total = restarts.length + (generations.length - absorbed.size);
  return { total, escalate: total >= threshold };
}

/** Stamp the actuator grace anchor. KeepAlive respawns must NOT call this. */
export function stampLastRestart(deps: SupervisionDeps, paths: SupervisionPaths): void {
  writeAtomic(deps, paths.lastRestartStamp, `${Math.floor(deps.now() / 1000)}\n`);
}

export function readLastRestartEpochSec(deps: SupervisionDeps, paths: SupervisionPaths): number | null {
  if (!deps.fs.existsSync(paths.lastRestartStamp)) return null;
  const epoch = parseInt(deps.fs.readFileSync(paths.lastRestartStamp).trim(), 10);
  return Number.isInteger(epoch) ? epoch : null;
}

/**
 * Wrapper-start bookkeeping: append to the GENERATION ledger (not the restart
 * ledger, and no last-restart stamp) and fire escalation side effects if the
 * combined rate crosses the threshold [R12].
 */
export function appendGenerationStart(deps: SupervisionDeps, paths: SupervisionPaths, gen: number): void {
  appendLedger(deps, paths.generationLedger, "generation-start", String(gen));
  const { total, escalate } = evaluateEscalation(deps, paths);
  if (escalate) {
    notifyEscalation(deps, paths, `generation-start ${gen}: ${total} restarts/respawns in the last hour`);
  }
}

/**
 * ESCALATION side effects: log line + best-effort macOS notification + best-
 * effort app-API POST (local API key over the nextjs unix socket). Never
 * throws; escalation never blocks the restart itself.
 */
export function notifyEscalation(deps: SupervisionDeps, paths: SupervisionPaths, detail: string): void {
  deps.log(`ESCALATION: ${detail}`);
  try {
    deps.exec([
      "osascript",
      "-e",
      `display notification ${JSON.stringify(detail)} with title "Remote Dev supervision"`,
    ]);
  } catch {
    // best-effort
  }
  try {
    if (deps.fs.existsSync(paths.localApiKeyFile)) {
      const key = deps.fs.readFileSync(paths.localApiKeyFile).trim();
      if (key) {
        deps.exec([
          "curl",
          "-s",
          "-o",
          "/dev/null",
          "--max-time",
          "5",
          "--unix-socket",
          paths.nextSocket,
          "-X",
          "POST",
          "-H",
          `Authorization: Bearer ${key}`,
          "-H",
          "Content-Type: application/json",
          "-d",
          JSON.stringify({ type: "error", title: "Prod supervision escalation", body: detail }),
          "http://localhost/api/notifications",
        ]);
      }
    }
  } catch {
    // best-effort
  }
}

/**
 * Bookkeeping for a SUCCESSFUL actuation by ANY actuator (watchdog, rdv
 * kickstart/bootstrap/foreground start, deploy bootstrap) [F17, F12]:
 * restart-ledger entry, escalation evaluation, last-restart grace stamp, and
 * watchdog counter reset. Callers must invoke this only AFTER the actuation
 * verifiably succeeded — a failed actuation must NOT stamp grace or reset
 * counters (that would delay the retry).
 */
export function recordActuation(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  actor: string,
  reason: string,
): void {
  appendLedger(deps, paths.restartLedger, actor, reason);
  const { total, escalate } = evaluateEscalation(deps, paths);
  if (escalate) {
    // Threshold crossed: the restart already happened, but raise the alarm.
    notifyEscalation(deps, paths, `${actor} ${reason}: ${total} restarts/respawns in the last hour`);
  }
  stampLastRestart(deps, paths);
  resetWatchdogState(deps, paths);
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchdog state + grace math [F7, F12, R10]
// ─────────────────────────────────────────────────────────────────────────────

export interface WatchdogState {
  /** Generation the flap ticks are keyed to (reset on gen change). */
  gen: number | null;
  /** Consecutive failed observations (counted even during grace). */
  failures: number;
  /** Consecutive flap-pattern ticks for the current gen. */
  flapTicks: number;
  updatedAt: number;
}

export function readWatchdogState(deps: SupervisionDeps, paths: SupervisionPaths): WatchdogState {
  if (deps.fs.existsSync(paths.watchdogStateFile)) {
    // The READ is outside the try on purpose: a parse failure is repairable
    // (the counters are rewritten), but an fs failure is evidence-unavailable
    // and must propagate rather than silently zero the counters.
    const raw = deps.fs.readFileSync(paths.watchdogStateFile);
    try {
      const parsed = JSON.parse(raw) as WatchdogState;
      return {
        gen: typeof parsed.gen === "number" ? parsed.gen : null,
        failures: Number.isInteger(parsed.failures) ? parsed.failures : 0,
        flapTicks: Number.isInteger(parsed.flapTicks) ? parsed.flapTicks : 0,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      };
    } catch {
      // fall through to fresh state
    }
  }
  return { gen: null, failures: 0, flapTicks: 0, updatedAt: 0 };
}

export function writeWatchdogState(deps: SupervisionDeps, paths: SupervisionPaths, s: WatchdogState): void {
  writeAtomic(deps, paths.watchdogStateFile, JSON.stringify(s, null, 2));
}

/** Full reset (healthy/suppressed ticks; post-actuation). The shim rm's this
 * same file on healthy ticks so no Bun startup is needed then. */
export function resetWatchdogState(deps: SupervisionDeps, paths: SupervisionPaths): void {
  try {
    if (deps.fs.existsSync(paths.watchdogStateFile)) deps.fs.unlinkSync(paths.watchdogStateFile);
  } catch {
    // best-effort
  }
}

export interface GraceTickInput {
  nowSec: number;
  lastRestartSec: number | null;
  graceSec: number;
  /** Failures BEFORE this tick. */
  priorFailures: number;
  maxFailures: number;
}

export interface GraceTickResult {
  /** Failures AFTER counting this tick (counted even during grace [R10]). */
  failures: number;
  inGrace: boolean;
  /** Act on this tick (grace expired AND the threshold is met). */
  shouldAct: boolean;
}

/**
 * Grace counting math [F7, F12, R10]: within `graceSec` of the last actuation
 * the watchdog STILL COUNTS failed observations but defers action; the first
 * post-grace failed tick may then act immediately if the accumulated count
 * meets the threshold — keeping worst-case detection ≈ grace + 1 tick.
 * (A healthy tick resets the counter in the shim, so "first post-grace tick
 * healthy ⇒ counter resets" holds by construction.)
 */
export function evaluateGraceTick(i: GraceTickInput): GraceTickResult {
  const failures = i.priorFailures + 1;
  const inGrace = i.lastRestartSec !== null && i.nowSec - i.lastRestartSec < i.graceSec;
  return { failures, inGrace, shouldAct: !inGrace && failures >= i.maxFailures };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy custody journal [F3, R4, R9]
// ─────────────────────────────────────────────────────────────────────────────

export interface CustodyJournal {
  ownerPid: number;
  ownerStartTimeNs: string;
  /** Was the launchd job loaded before the deploy took custody? [R9] */
  priorLoaded: boolean;
  plistPath: string;
  /** The known-good slot to restore if this custody is abandoned. */
  slot: string;
  phase: string;
  ts: number;
  /**
   * A recovery bootstrapped prod but could NOT restore the journaled slot [R4]:
   * the running stack is serving an unreconciled build. The flag survives in
   * the journal so the eventual close-out escalates PARTIAL exactly once
   * instead of silently dropping the failed restoration.
   */
  restorePending?: boolean;
}

/**
 * Read the custody journal with full structural validation. A file that
 * exists but is structurally invalid is CORRUPT maintenance evidence — it
 * must fail closed (escalate, no recovery) rather than read as "absent"
 * (which would classify custody as unrecoverable "none") or as a guessable
 * journal.
 */
export function readCustodyJournal(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
): CustodyJournal | "corrupt" | null {
  if (!deps.fs.existsSync(paths.custodyJournal)) return null;
  try {
    const parsed = JSON.parse(deps.fs.readFileSync(paths.custodyJournal)) as CustodyJournal;
    const valid =
      typeof parsed.ownerPid === "number" &&
      Number.isInteger(parsed.ownerPid) &&
      parsed.ownerPid > 0 &&
      typeof parsed.ownerStartTimeNs === "string" &&
      parsed.ownerStartTimeNs.length > 0 &&
      typeof parsed.priorLoaded === "boolean" &&
      typeof parsed.plistPath === "string" &&
      parsed.plistPath.length > 0 &&
      typeof parsed.slot === "string" &&
      parsed.slot.length > 0 &&
      typeof parsed.phase === "string" &&
      parsed.phase.length > 0 &&
      typeof parsed.ts === "number" &&
      (parsed.restorePending === undefined || typeof parsed.restorePending === "boolean");
    return valid ? parsed : "corrupt";
  } catch (err) {
    if (err instanceof SupervisionEvidenceError) throw err;
    return "corrupt";
  }
}

/**
 * Does this journal belong to THIS process? Custody methods must verify it
 * before acting [R4]: two deploys can overlap (deploy A dies after bootout,
 * deploy B starts before the watchdog runs), and a finalize() that acted on a
 * FOREIGN journal would bootstrap unrestored files, write desired=running and
 * erase A's recovery evidence.
 */
export function custodyJournalOwnedBy(
  j: CustodyJournal,
  self: { pid: number; startTimeNs: string | null },
): boolean {
  if (j.ownerPid !== self.pid) return false;
  // An unreadable own start time cannot prove ownership — fail closed.
  if (self.startTimeNs === null) return false;
  return j.ownerStartTimeNs === self.startTimeNs;
}

export function writeCustodyJournal(deps: SupervisionDeps, paths: SupervisionPaths, j: CustodyJournal): void {
  writeAtomic(deps, paths.custodyJournal, JSON.stringify(j, null, 2));
}

/**
 * Remove the custody journal. Returns false if it could NOT be removed — the
 * caller must not report custody as closed then: a surviving journal owned by
 * a dead deploy blocks the next one until recovery clears it.
 */
export function clearCustodyJournal(deps: SupervisionDeps, paths: SupervisionPaths): boolean {
  try {
    if (deps.fs.existsSync(paths.custodyJournal)) deps.fs.unlinkSync(paths.custodyJournal);
    return true;
  } catch (err) {
    deps.log(`could not clear custody-journal.json: ${String(err)}`);
    return false;
  }
}

/**
 * Close a custody journal out. A journal carrying `restorePending` records a
 * recovery that bootstrapped prod WITHOUT restoring the journaled slot [R4]:
 * clearing it silently would drop that fact forever, while retaining it
 * forever would loop. So the close-out escalates PARTIAL exactly once — the
 * operator reconciles the slot — and then clears.
 */
export function closeOutCustodyJournal(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  journal: CustodyJournal,
  detail: string,
  opts: { escalateOnClean?: boolean } = {},
): void {
  if (journal.restorePending) {
    notifyEscalation(
      deps,
      paths,
      `custody close-out PARTIAL: prod is running but the journaled slot "${journal.slot}" was never ` +
        `restored (deploy pid ${journal.ownerPid}, phase ${journal.phase}) — the live build is ` +
        `UNRECONCILED; an operator must verify/redeploy it. Journal cleared (${detail}).`,
    );
  } else if (opts.escalateOnClean) {
    notifyEscalation(deps, paths, `custody finalized: ${detail}`);
  } else {
    deps.log(`custody journal closed: ${detail}`);
  }
  clearCustodyJournal(deps, paths);
}

// ─────────────────────────────────────────────────────────────────────────────
// Abandoned deploy results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The subset of deploy.ts's DeployResult this module needs. A deploy stamps
 * its own identity into the `in_progress` record it leaves while the final
 * health gate runs, so a deploy that dies in that window can be recognized
 * afterwards rather than leaving the CI poll reading "running" forever.
 */
interface DeployResultRecord {
  status: string;
  stage?: string;
  error?: string;
  finishedAt?: string;
  owner?: { pid: number; startTimeNs: string };
  [key: string]: unknown;
}

/**
 * Rewrite an `in_progress` deploy result whose owner is PROVABLY dead into a
 * failure [C]. Without this, a SIGKILL during finalization (or a crash between
 * the state write and the result write) leaves a permanent "running" that no
 * poll can ever resolve.
 *
 * Identity is the gate, and only "dead" counts: an owner whose identity cannot
 * be read might still be finishing the deploy, and declaring its run failed
 * would be a lie in the other direction. Returns true when a rewrite happened
 * (callers escalate once — the record is no longer `in_progress`, so it cannot
 * repeat).
 */
export function reconcileAbandonedDeployResult(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
): boolean {
  if (!deps.fs.existsSync(paths.deployResultFile)) return false;
  let record: DeployResultRecord;
  try {
    record = JSON.parse(deps.fs.readFileSync(paths.deployResultFile)) as DeployResultRecord;
  } catch {
    // A corrupt result file is the deploy pipeline's business, not ours.
    return false;
  }
  if (!record || typeof record !== "object" || record.status !== "in_progress") return false;
  const owner = record.owner;
  if (
    !owner ||
    typeof owner.pid !== "number" ||
    !Number.isInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.startTimeNs !== "string" ||
    owner.startTimeNs.length === 0
  ) {
    // No owner stamp (a pre-upgrade record, or a stage that does not claim
    // one): we cannot prove abandonment, so we leave it alone.
    return false;
  }
  const state = procIdentityState(deps, { pid: owner.pid, pgid: owner.pid, startTimeNs: owner.startTimeNs });
  // "identity-unavailable" ⇒ fail closed, leave the record as-is.
  if (state !== "dead" && state !== "alive-different-identity") return false;

  const now = new Date(deps.now()).toISOString();
  writeAtomic(
    deps,
    paths.deployResultFile,
    JSON.stringify(
      {
        ...record,
        status: "failed",
        stage: record.stage ?? "finalize",
        error:
          `deploy process ${owner.pid} died during finalization (stage ${record.stage ?? "finalize"}); ` +
          "the run never reached a verified-healthy state. Supervision rewrote this result so the " +
          "poll does not wait on a deploy that is gone.",
        finishedAt: now,
      },
      null,
      2,
    ),
  );
  return true;
}

export type CustodyClass = "none" | "active" | "intentional-stop" | "abandoned";

/**
 * Classify a custody journal [R4, R5]:
 *   - none: no journal.
 *   - active: the deploy owner is alive (identity-verified OR pid-alive) or a
 *     live deploy holds deploy.lock — leave it alone.
 *   - intentional-stop: owner dead but desired=stopped — an operator stop, the
 *     watchdog must not undo it.
 *   - abandoned: owner dead, deploy lock free, desired != stopped — the
 *     watchdog restores per journal.
 */
export function classifyCustody(i: {
  journal: CustodyJournal | null;
  desiredState: DesiredStateValue | null;
  ownerAlive: boolean;
  deployLockLive: boolean;
}): CustodyClass {
  if (!i.journal) return "none";
  if (i.ownerAlive || i.deployLockLive) return "active";
  if (i.desiredState === "stopped") return "intentional-stop";
  return "abandoned";
}

/**
 * Is the journal's recorded owner possibly still alive? Quad-state mapping:
 * "dead" and "alive-different-identity" (pid recycled ⇒ the original owner is
 * gone) count as dead; "alive-same-identity" is alive; and
 * "identity-unavailable" counts as ALIVE — death must be PROVEN before the
 * watchdog recovers over a possibly-live deploy (fail closed) [R13].
 */
export function custodyOwnerAlive(deps: SupervisionDeps, j: CustodyJournal): boolean {
  const state = procIdentityState(deps, {
    pid: j.ownerPid,
    pgid: j.ownerPid,
    startTimeNs: j.ownerStartTimeNs,
  });
  return state === "alive-same-identity" || state === "identity-unavailable";
}

// ─────────────────────────────────────────────────────────────────────────────
// Local origin probes (curl over the unix sockets; prod-only, no TCP fallback)
// ─────────────────────────────────────────────────────────────────────────────

export function probeUnixHttp(
  deps: SupervisionDeps,
  socketPath: string,
  urlPath: string,
): number {
  const st = deps.fs.lstatSync(socketPath);
  if (!st || !st.isSocket) return 0; // missing socket IS failure evidence [F14].
  const res = deps.exec([
    "curl",
    "-s",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    "--max-time",
    "10",
    "--unix-socket",
    socketPath,
    `http://localhost${urlPath}`,
  ]);
  if (res.exitCode !== 0) return 0;
  const code = parseInt(res.stdout.trim(), 10);
  return Number.isInteger(code) ? code : 0;
}

/** The full prod health predicate (mirrors the watchdog shim's three probes). */
export function probeProdHealthy(deps: SupervisionDeps, paths: SupervisionPaths): boolean {
  return (
    probeUnixHttp(deps, paths.nextSocket, "/api/healthz") === 200 &&
    probeUnixHttp(deps, paths.nextSocket, "/login") === 200 &&
    probeUnixHttp(deps, paths.terminalSocket, "/health") === 200
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation exit wait (used by stop + deploy custody)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the current-generation pointer to verifiable manifest evidence [R3]:
 *   - "ok": pointer resolves to a readable live manifest.
 *   - "no-evidence": no pointer at all (legacy/fresh host), or the pointer
 *     names a generation that was cleanly ARCHIVED (the wrapper archives on
 *     shutdown but does not clear the pointer) — nothing left to verify.
 *   - "unverifiable": the pointer names a generation whose manifest is
 *     CORRUPT or simply GONE (neither live nor archived). We cannot prove
 *     what is running or who owns the sockets — callers must FAIL CLOSED and
 *     require `rdv doctor-supervision --force-reclaim`.
 */
export function currentGenerationState(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
): { gen: number | null; manifest: GenerationManifest | null; state: "ok" | "no-evidence" | "unverifiable" } {
  const gen = readCurrentGen(deps, paths);
  if (gen === null) return { gen: null, manifest: null, state: "no-evidence" };
  const m = readManifest(deps, paths, gen);
  if (m === "corrupt") return { gen, manifest: null, state: "unverifiable" };
  if (m === null) {
    const archived =
      deps.fs.existsSync(join(paths.generationsArchiveDir, `${gen}.json`)) ||
      deps.fs.existsSync(join(paths.generationsArchiveDir, `${gen}.json.corrupt`));
    return { gen, manifest: null, state: archived ? "no-evidence" : "unverifiable" };
  }
  return { gen, manifest: m, state: "ok" };
}

export type GenerationExitOutcome = "exited" | "timeout" | "no-evidence" | "unverifiable";

/**
 * Wait (bounded) for EVERY live generation's manifest processes to be
 * verifiably gone (leader dead + child pgroups empty — manifestFullyDead).
 * ALL non-archived manifests count, not just the pointed one: an unpublished
 * `starting` generation is live evidence too. "no-evidence" (nothing to wait
 * on) is a pass for callers; "timeout" and "unverifiable" (a dangling pointer
 * or ANY corrupt manifest) must be treated as FAILURES — proceeding would run
 * destructive steps with processes possibly still alive [R3].
 */
export async function waitForGenerationExit(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  timeoutMs: number,
): Promise<GenerationExitOutcome> {
  if (currentGenerationState(deps, paths).state === "unverifiable") return "unverifiable";
  const { manifests, corruptGens } = readAllLiveManifests(deps, paths);
  if (corruptGens.length > 0) return "unverifiable";
  if (manifests.length === 0) return "no-evidence";
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    if (manifests.every((m) => manifestFullyDead(deps, m))) return "exited";
    if (deps.now() >= deadline) return "timeout";
    await deps.sleep(250);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// watchdog-act — the §3.6 recovery transaction
// ─────────────────────────────────────────────────────────────────────────────

export interface WatchdogActOptions {
  maxFailures?: number;
  graceSec?: number;
  /** Restore a build slot over the live dir (custody recovery). */
  restoreSlot?: (slot: string) => boolean;
  projectRoot?: string;
}

function defaultRestoreSlot(paths: SupervisionPaths, projectRoot: string): (slot: string) => boolean {
  return (slot: string) => {
    const res = restoreStandalone(
      join(paths.buildsDir, slot, "standalone"),
      join(projectRoot, ".next", "standalone"),
    );
    return res.ok;
  };
}

/**
 * The watchdog actuator. The shim calls this on any actionable condition; the
 * WHOLE recovery transaction runs under the control lock. Returns an exit code.
 */
export async function watchdogAct(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  reason: string,
  opts: WatchdogActOptions = {},
): Promise<number> {
  const maxFailures = opts.maxFailures ?? DEFAULT_MAX_FAILURES;
  const graceSec = opts.graceSec ?? GRACE_SECONDS;
  const projectRoot = opts.projectRoot ?? process.cwd();
  const restoreSlot = opts.restoreSlot ?? defaultRestoreSlot(paths, projectRoot);

  const lock = await acquireControlLock(deps, paths);
  if (!lock) {
    deps.log(`watchdog-act(${reason}): control lock unavailable; aborting without action`);
    return 1;
  }
  try {
    // Deploy suppression resets the counter [F12].
    if (deployLockLive(deps, paths)) {
      deps.log(`watchdog-act(${reason}): live deploy holds deploy.lock; suppressed (counter reset)`);
      resetWatchdogState(deps, paths);
      return 0;
    }

    const desired = readDesiredState(deps, paths);
    // "custody-check" is the shim's HEALTHY-tick custody sweep: it runs the
    // desired-state/journal bookkeeping below and then exits WITHOUT any
    // failure counting or actuation (the probes passed).
    const custodyCheckOnly = reason === "custody-check";

    // A CORRUPT desired-state file fails CLOSED [R5]: it may have said
    // `stopped`, and guessing "running" could kickstart an intentionally
    // stopped job. Escalate; `rdv start prod` / `rdv stop` are the repairs
    // (they rewrite the file atomically).
    if (desired === "corrupt") {
      deps.log(
        `watchdog-act(${reason}): desired-state.json is CORRUPT; fail closed — ` +
          `repair with \`rdv start prod\` or \`rdv stop\``,
      );
      notifyEscalation(deps, paths, "desired-state.json is corrupt; watchdog cannot act safely");
      return 1;
    }

    // A CORRUPT custody journal is corrupt maintenance evidence — never
    // "absent", never guessable. Fail closed + escalate.
    const journal = readCustodyJournal(deps, paths);
    if (journal === "corrupt") {
      deps.log(`watchdog-act(${reason}): custody-journal.json is CORRUPT; fail closed`);
      notifyEscalation(deps, paths, "custody-journal.json is corrupt; watchdog cannot classify custody safely");
      return 1;
    }

    // Intentional stop gates the watchdog entirely [R5].
    if (desired?.state === "stopped") {
      deps.log(`watchdog-act(${reason}): desired state is stopped; no action`);
      resetWatchdogState(deps, paths);
      return 0;
    }

    // Maintenance: run the abandoned-custody check (§3.5.4), never a blind
    // bootstrap.
    if (desired?.state === "maintenance") {
      const cls = classifyCustody({
        journal,
        desiredState: desired.state,
        ownerAlive: journal ? custodyOwnerAlive(deps, journal) : false,
        deployLockLive: deployLockLive(deps, paths),
      });
      if (cls === "abandoned" && journal) {
        deps.log(
          `watchdog-act(${reason}): abandoned deploy custody (owner pid ${journal.ownerPid} dead, ` +
            `phase ${journal.phase}); recovering per journal [R4]`,
        );
        const jobLoadedNow = launchdJobLoaded(deps, PROD_LABEL);
        if (jobLoadedNow === "unknown") {
          notifyEscalation(deps, paths, "custody recovery: launchd state unknown; fail closed [F9]");
          return 1;
        }
        if (jobLoadedNow === true) {
          // The job is LOADED: the running stack is the evidence — NEVER
          // restore build files under a live process. Verify health; if
          // healthy, the deploy died after a successful bootstrap and custody
          // just needs closing (no files/processes change ⇒ no actuation
          // record [F17]).
          if (probeProdHealthy(deps, paths)) {
            writeDesiredState(deps, paths, "running");
            closeOutCustodyJournal(
              deps,
              paths,
              journal,
              `deploy pid ${journal.ownerPid} died after bootstrap; prod verified healthy`,
              { escalateOnClean: true },
            );
            deps.log("custody recovery: job loaded + healthy — custody finalized (journal cleared)");
            resetWatchdogState(deps, paths);
            return 0;
          }
          // Loaded but unhealthy: take real custody — bootout, then restore +
          // bootstrap below. Failures keep the journal for retry.
          if (!bootoutJob(deps, PROD_LABEL)) {
            notifyEscalation(deps, paths, "custody recovery: bootout of unhealthy loaded job failed; journal retained");
            return 1;
          }
          const exitOutcome = await waitForGenerationExit(deps, paths, 40_000);
          if (exitOutcome === "timeout" || exitOutcome === "unverifiable") {
            notifyEscalation(
              deps,
              paths,
              `custody recovery: generation did not verifiably exit after bootout (${exitOutcome}); journal retained`,
            );
            return 1;
          }
        } else {
          // Job NOT loaded: before touching build files, the old generation
          // must be verifiably gone — restoring under known-alive processes
          // is the same hazard as restoring under a loaded job.
          const exitOutcome = await waitForGenerationExit(deps, paths, 10_000);
          if (exitOutcome === "timeout" || exitOutcome === "unverifiable") {
            notifyEscalation(
              deps,
              paths,
              `custody recovery: old generation still alive/unverifiable (${exitOutcome}); journal retained`,
            );
            return 1;
          }
        }
        // Job not loaded and generations verifiably gone: restore the
        // journaled known-good slot (every surviving journal means activation
        // never completed), then bootstrap.
        const restoreOk = restoreSlot(journal.slot);
        if (!restoreOk) {
          deps.log(`custody recovery: slot restore (${journal.slot}, phase ${journal.phase}) FAILED`);
        }
        let bootstrapOk = true;
        if (journal.priorLoaded) {
          bootstrapOk = bootstrapJob(deps, journal.plistPath);
        }
        if (!bootstrapOk) {
          // Prod is still down. Keep the journal + maintenance so the next
          // tick retries; DO NOT report a recovery that did not happen.
          notifyEscalation(
            deps,
            paths,
            `custody-recovery FAILED: bootstrap of ${PROD_LABEL} failed (deploy pid ${journal.ownerPid} ` +
              `dead, phase ${journal.phase}); journal retained for retry`,
          );
          return 1;
        }
        if (!restoreOk) {
          // A REAL state change happened (bootstrap) but on an unrestored
          // build — record the actuation, keep the journal for retry [F17].
          // The retry intent is made DURABLE via restorePending: if the next
          // tick finds this stack loaded + healthy, the close-out must not
          // quietly clear the journal as if the restoration had happened [R4].
          writeCustodyJournal(deps, paths, { ...journal, restorePending: true });
          recordActuation(deps, paths, "watchdog", "custody-recovery-partial");
          notifyEscalation(
            deps,
            paths,
            `custody-recovery PARTIAL: ${PROD_LABEL} bootstrapped but slot restore (${journal.slot}) ` +
              `failed; journal retained for retry`,
          );
          return 1;
        }
        writeDesiredState(deps, paths, "running");
        recordActuation(deps, paths, "watchdog", "custody-recovery");
        // The slot WAS restored on this pass, so any pending restoration from
        // an earlier partial recovery is now reconciled.
        closeOutCustodyJournal(
          deps,
          paths,
          { ...journal, restorePending: false },
          `deploy pid ${journal.ownerPid} died after bootout (phase ${journal.phase}); prod restored`,
          { escalateOnClean: true },
        );
        return 0;
      }
      if (cls === "active") {
        deps.log(`watchdog-act(${reason}): deploy custody active; no action`);
        resetWatchdogState(deps, paths);
        return 0;
      }
      // maintenance with NO journal (or an intentional stop mid-classify):
      // fail closed — a blind bootstrap here could fight a deploy we cannot
      // see. Escalate for the operator instead.
      deps.log(
        `watchdog-act(${reason}): desired=maintenance but no actionable custody journal (${cls}); ` +
          `fail closed — operator attention required (rdv doctor-supervision)`,
      );
      notifyEscalation(deps, paths, "maintenance state with no recoverable custody journal");
      return 0;
    }

    // Leftover journal with desired running/unset: the deploy's finalize was
    // killed between writeDesiredState(running) and clearCustodyJournal. If
    // the owner is provably dead, the lock free, and prod verifiably loaded +
    // healthy, close the journal (nothing else to do); otherwise escalate and
    // leave the evidence in place.
    if (journal) {
      if (!custodyOwnerAlive(deps, journal) && !deployLockLive(deps, paths)) {
        if (launchdJobLoaded(deps, PROD_LABEL) === true && probeProdHealthy(deps, paths)) {
          deps.log("clearing leftover custody journal (finalize died after desired=running; prod verified healthy)");
          closeOutCustodyJournal(
            deps,
            paths,
            journal,
            `leftover journal from deploy pid ${journal.ownerPid} closed; prod verified healthy`,
          );
        } else {
          notifyEscalation(
            deps,
            paths,
            "leftover custody journal (owner dead, desired!=maintenance) but prod is not verifiably healthy; operator attention required",
          );
        }
      }
    }

    // An `in_progress` deploy result whose owner is provably dead is a deploy
    // that died during finalization. Nothing else will ever resolve it, so the
    // CI poll would read "running" forever — rewrite it to failed once, and
    // escalate once (the record is no longer in_progress, so this cannot
    // repeat). Runs on every tick, healthy ones included.
    if (reconcileAbandonedDeployResult(deps, paths)) {
      deps.log("rewrote an abandoned in_progress deploy result to failed (owner process is dead)");
      notifyEscalation(
        deps,
        paths,
        "a deploy died during finalization; its in_progress result was rewritten to failed — " +
          "prod was never verified healthy for that run",
      );
    }

    // Healthy-tick custody sweep ends here — no failure accounting.
    if (custodyCheckOnly) {
      return 0;
    }

    // ANY corrupt/unverifiable generation evidence blocks actuation entirely:
    // a kickstart would just crash-loop the new wrapper against the same
    // corrupt-manifest fail-closed reclaim. No grace stamp, no counter reset,
    // operator force-reclaim required [R3].
    const { corruptGens: actGateCorrupt } = readAllLiveManifests(deps, paths);
    const pointerState = currentGenerationState(deps, paths);
    if (actGateCorrupt.length > 0 || pointerState.state === "unverifiable") {
      deps.log(
        `watchdog-act(${reason}): generation evidence corrupt/unverifiable ` +
          `(gens ${actGateCorrupt.join(",") || pointerState.gen}); fail closed — ` +
          `run \`rdv doctor-supervision --force-reclaim\``,
      );
      notifyEscalation(
        deps,
        paths,
        "generation manifests corrupt/unverifiable; watchdog cannot actuate — operator force-reclaim required",
      );
      return 1;
    }

    // desired running (or unset — a legacy host that never wrote it).
    const nowSec = Math.floor(deps.now() / 1000);
    const state = readWatchdogState(deps, paths);
    const lastRestartSec = readLastRestartEpochSec(deps, paths);
    const tick = evaluateGraceTick({
      nowSec,
      lastRestartSec,
      graceSec,
      priorFailures: state.failures,
      maxFailures,
    });

    // Grace: count, defer, and reset the flap persistence (a grace tick is a
    // flap-state reset tick per §3.6).
    if (tick.inGrace) {
      writeWatchdogState(deps, paths, {
        gen: state.gen,
        failures: tick.failures,
        flapTicks: 0,
        updatedAt: deps.now(),
      });
      deps.log(
        `watchdog-act(${reason}): within ${graceSec}s grace; counted failure ${tick.failures}, action deferred`,
      );
      return 0;
    }

    // Run an actuation; success gets the full bookkeeping (ledger + grace
    // stamp + counter reset). A FAILED actuation must NOT be recorded as a
    // restart [F17]: no ledger entry, no grace stamp (the next tick retries
    // immediately), counters preserved, escalation raised, non-zero exit.
    const actuate = async (
      actReason: string,
      persistOnFailure: WatchdogState,
      fn: () => Promise<boolean> | boolean,
    ): Promise<number> => {
      const ok = await fn();
      if (!ok) {
        deps.log(`watchdog-act(${reason}): actuation (${actReason}) FAILED — counters preserved for retry`);
        notifyEscalation(deps, paths, `watchdog actuation FAILED (${actReason}); manual intervention may be required`);
        writeWatchdogState(deps, paths, persistOnFailure);
        return 1;
      }
      recordActuation(deps, paths, "watchdog", actReason);
      return 0;
    };

    // Flap fast-path [F7]: socket path absent + current-generation next PID
    // identity-verified alive + generation age > 120s, persisted 2 consecutive
    // ticks keyed by gen.
    const gen = readCurrentGen(deps, paths);
    const manifest = gen !== null ? readManifest(deps, paths, gen) : null;
    if (manifest && manifest !== "corrupt" && manifest.next) {
      const sockMissing = deps.fs.lstatSync(paths.nextSocket) === null;
      const genAgeSec = (deps.now() - manifest.startedAt) / 1000;
      const flapPattern =
        sockMissing &&
        verifyProcIdentity(deps, manifest.next) &&
        genAgeSec > FLAP_MIN_GENERATION_AGE_SECONDS;
      if (flapPattern) {
        const flapTicks = (state.gen === gen ? state.flapTicks : 0) + 1;
        if (flapTicks >= FLAP_TICKS_REQUIRED) {
          deps.log(
            `watchdog-act(${reason}): flap confirmed (gen ${gen}, ${flapTicks} ticks) — reclaim + kickstart`,
          );
          const jobLoaded = launchdJobLoaded(deps, PROD_LABEL);
          return actuate(
            "flap",
            { gen, failures: tick.failures, flapTicks, updatedAt: deps.now() },
            async () => {
              // Reclaim prior-generation leftovers (the current gen is
              // respawned by kickstart, whose wrapper does its own pre-spawn
              // reclaim). A reclaim failure (e.g. corrupt manifest) FAILS the
              // actuation — kickstarting blind would just crash-loop the
              // wrapper against the same fail-closed condition.
              try {
                const res = await reclaimPriorGenerations(deps, paths, { currentGen: gen });
                if (res.unresolvedGens.length > 0) {
                  // Survivors that could be neither attributed nor killed. A
                  // kickstart now would only crash-loop the new wrapper
                  // against the same fail-closed gate.
                  deps.log(
                    `flap reclaim left unresolved generation(s): ${res.unresolvedGens
                      .map((u) => `${u.gen} (${u.detail})`)
                      .join("; ")}`,
                  );
                  return false;
                }
              } catch (err) {
                deps.log(`flap reclaim failed: ${String(err)}`);
                return false;
              }
              if (jobLoaded === true) {
                return kickstartJob(deps, PROD_LABEL);
              }
              if (deps.fs.existsSync(paths.prodPlist)) {
                return bootstrapJob(deps, paths.prodPlist);
              }
              deps.log("flap: no launchd job/plist — cannot actuate; operator attention required");
              return false;
            },
          );
        }
        writeWatchdogState(deps, paths, {
          gen,
          failures: tick.failures,
          flapTicks,
          updatedAt: deps.now(),
        });
        deps.log(`watchdog-act(${reason}): flap pattern tick ${flapTicks}/${FLAP_TICKS_REQUIRED} (gen ${gen})`);
        return 0;
      }
    }

    // Generic consecutive-failure action.
    if (tick.shouldAct) {
      const jobLoaded = launchdJobLoaded(deps, PROD_LABEL);
      if (jobLoaded === "unknown") {
        deps.log(`watchdog-act(${reason}): launchctl state unknown; fail closed [F9]`);
        notifyEscalation(deps, paths, "watchdog cannot determine launchd state; manual intervention required");
        return 1;
      }
      deps.log(`watchdog-act(${reason}): ${tick.failures} consecutive failures — actuating`);
      return actuate(
        reason,
        { gen: gen ?? state.gen, failures: tick.failures, flapTicks: 0, updatedAt: deps.now() },
        () => {
          if (jobLoaded) {
            return kickstartJob(deps, PROD_LABEL);
          }
          if (deps.fs.existsSync(paths.prodPlist)) {
            // Job unloaded while desired=running (e.g. recovered maintenance
            // edge): bootstrap starts it (KeepAlive ⇒ RunAtLoad [F10]).
            return bootstrapJob(deps, paths.prodPlist);
          }
          deps.log("no launchd job/plist installed — cannot actuate; operator attention required");
          return false;
        },
      );
    }

    // Below threshold: persist and wait for the next tick.
    writeWatchdogState(deps, paths, {
      gen: gen ?? state.gen,
      failures: tick.failures,
      flapTicks: 0,
      updatedAt: deps.now(),
    });
    deps.log(`watchdog-act(${reason}): failure ${tick.failures}/${maxFailures}; below threshold`);
    return 0;
  } catch (err) {
    // Supervision EVIDENCE could not be read (unreadable generations dir,
    // failing lstat, …). That is never "nothing is running": actuating or
    // cleaning up on unreadable evidence is how live sockets get unlinked.
    // Fail closed, escalate, leave every counter and file untouched.
    if (err instanceof SupervisionEvidenceError) {
      deps.log(`watchdog-act(${reason}): ${err.message}; fail closed — no action taken`);
      notifyEscalation(
        deps,
        paths,
        `watchdog cannot read supervision evidence (${err.message}); no action taken — operator attention required`,
      );
      return 1;
    }
    throw err;
  } finally {
    lock.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// doctor-supervision [--force-reclaim]
// ─────────────────────────────────────────────────────────────────────────────

export async function doctorSupervision(
  deps: SupervisionDeps,
  paths: SupervisionPaths,
  opts: { forceReclaim?: boolean } = {},
): Promise<number> {
  const jobLoaded = launchdJobLoaded(deps, PROD_LABEL);
  const desired = readDesiredState(deps, paths);
  const gen = readCurrentGen(deps, paths);
  const manifest = gen !== null ? readManifest(deps, paths, gen) : null;
  const journal = readCustodyJournal(deps, paths);

  deps.log(`launchd ${PROD_LABEL}: ${jobLoaded === "unknown" ? "UNKNOWN" : jobLoaded ? "loaded" : "not loaded"}`);
  deps.log(
    `desired state: ${
      desired === "corrupt"
        ? "CORRUPT (repair with `rdv start prod` or `rdv stop`)"
        : desired
          ? `${desired.state} (ts ${new Date(desired.ts).toISOString()})`
          : "(unset)"
    }`,
  );
  deps.log(`current generation: ${gen ?? "(none)"}`);
  if (manifest === "corrupt") deps.log("current generation manifest: CORRUPT");
  else if (manifest) {
    deps.log(`  phase=${manifest.phase} startedAt=${new Date(manifest.startedAt).toISOString()}`);
    for (const [name, id] of Object.entries({ wrapper: manifest.wrapper, next: manifest.next, terminal: manifest.terminal })) {
      if (!id) continue;
      deps.log(`  ${name}: pid ${id.pid} pgid ${id.pgid} ${verifyProcIdentity(deps, id) ? "VERIFIED-ALIVE" : "dead/stale"}`);
    }
  }
  deps.log(
    `custody journal: ${
      journal === "corrupt" ? "CORRUPT" : journal ? `phase=${journal.phase} owner=${journal.ownerPid}` : "(none)"
    }`,
  );
  deps.log(`deploy lock: ${deployLockLive(deps, paths) ? "LIVE" : "free"}`);

  if (opts.forceReclaim) {
    // Reclaiming during a LIVE deploy would interfere with its custody
    // transition — refuse, matching every other actuator [F11, R8].
    if (deployLockLive(deps, paths)) {
      deps.log("doctor-supervision: a live deploy holds deploy.lock; refusing force-reclaim mid-deploy");
      return 1;
    }
    const lock = await acquireControlLock(deps, paths);
    if (!lock) {
      deps.log("doctor-supervision: control lock unavailable; aborting force-reclaim");
      return 1;
    }
    try {
      deps.log("force-reclaim: reclaiming prior generations WITH operator consent (corrupt manifests tolerated)");
      // Any deploy-restart authorization left behind by a crashed deploy is
      // supervision residue too — invalidate it so it can never authorize a
      // foreground start later.
      clearDeployRestartToken(deps, paths);
      const res = await reclaimPriorGenerations(deps, paths, { currentGen: gen, force: true });
      // Operator consent extends to corrupt manifests: their files are moved
      // aside (never deleted) so a fresh start cannot trip on them again.
      for (const corrupt of res.corruptGens) {
        const file = manifestFile(paths, corrupt);
        try {
          deps.fs.mkdirSync(paths.generationsArchiveDir);
          deps.fs.renameSync(file, join(paths.generationsArchiveDir, `${corrupt}.json.corrupt`));
        } catch {
          // best-effort
        }
      }
      // Operator consent also extends to INTACT-but-unresolved generations —
      // the pid-less spawn placeholder, a survivor that could not be
      // positively attributed. Without this, `--force-reclaim` (the command
      // every fail-closed message points at) could not clear the very states
      // that block a start, and prod would stay unstartable by design.
      //
      // The one thing consent does NOT override is a LIVE HOLDER: before any
      // socket of such a generation is unlinked, lsof must show nobody holding
      // it. Unlinking a socket out from under a live server is the original
      // outage, and no flag may authorize it.
      const stillUnresolved: Array<{ gen: number; detail: string }> = [];
      for (const u of res.unresolvedGens) {
        const m = readManifest(deps, paths, u.gen);
        if (m === null || m === "corrupt") {
          stillUnresolved.push(u);
          continue;
        }
        // The holder check is re-run IMMEDIATELY before each destructive step
        // rather than once up front. A single check followed by several
        // unrelated steps is a multi-step TOCTOU: a process can bind between
        // the check and the unlink, and a socket that is merely ABSENT at
        // check time (a child mid-bind) would otherwise be archived away with
        // no unlink and no re-look. Re-validating leaves only a sub-millisecond
        // window between the last check and its own unlink — acceptable for an
        // explicitly human-invoked command, unlike a multi-second one. The
        // whole sequence runs under the control lock held by the caller.
        const claimPaths = claimedSocketPaths(m);
        const holdersNow = (): { path: string; detail: string }[] =>
          claimPaths
            .map((p) => ({ path: p, holder: socketHolder(deps, p) }))
            .filter((c) => c.holder.state !== "free")
            .map((c) => ({ path: c.path, detail: c.holder.detail }));

        const blocked = holdersNow();
        if (blocked.length > 0) {
          deps.log(
            `force-reclaim: REFUSING to retire generation ${u.gen} — its socket(s) still have a live or ` +
              `unverifiable holder: ${blocked.map((b) => b.detail).join("; ")}. ` +
              "Stop that process first (it is serving, or may be serving, on this socket).",
          );
          stillUnresolved.push(u);
          continue;
        }
        deps.log(
          `force-reclaim: retiring generation ${u.gen} WITH OPERATOR CONSENT. Evidence being discarded: ` +
            `${u.detail}. Sockets to unlink (re-verified holder-free at each step): ` +
            `${claimPaths.join(", ") || "(none)"}`,
        );
        let aborted = false;
        for (const path of claimPaths) {
          // Re-validate THIS path immediately before unlinking it.
          const holder = socketHolder(deps, path);
          if (holder.state !== "free") {
            deps.log(
              `force-reclaim: ABORTING retirement of generation ${u.gen} — ${holder.detail} appeared ` +
                "after the initial check; nothing further will be unlinked or archived.",
            );
            aborted = true;
            break;
          }
          const st = deps.fs.lstatSync(path);
          if (!st || !st.isSocket) continue;
          try {
            deps.fs.unlinkSync(path);
            res.unlinkedSockets.push(path);
          } catch (err) {
            deps.log(`force-reclaim: could not unlink ${path}: ${String(err)}`);
          }
        }
        if (aborted) {
          stillUnresolved.push(u);
          continue;
        }
        // …and once more before archiving, which is what makes the generation
        // invisible to every later reclaim.
        const lateHolders = holdersNow();
        if (lateHolders.length > 0) {
          deps.log(
            `force-reclaim: NOT archiving generation ${u.gen} — ${lateHolders
              .map((h) => h.detail)
              .join("; ")} appeared during retirement; its manifest stays as evidence.`,
          );
          stillUnresolved.push(u);
          continue;
        }
        archiveManifest(deps, paths, u.gen);
        res.archivedGens.push(u.gen);
      }

      deps.log(
        `force-reclaim done: killed pgids [${res.killedPgids.join(", ")}], ` +
          `unlinked [${res.unlinkedSockets.join(", ")}], archived gens [${res.archivedGens.join(", ")}], ` +
          `corrupt gens [${res.corruptGens.join(", ")}]`,
      );
      if (stillUnresolved.length > 0) {
        // Reporting 0 here would tell the operator the host is clean when a
        // start would still fail closed against these.
        for (const u of stillUnresolved) {
          deps.log(`force-reclaim: generation ${u.gen} STILL UNRESOLVED — ${u.detail}`);
        }
        deps.log(
          "force-reclaim: unresolved generations remain; prod starts will refuse until these " +
            "processes are gone (inspect the pids above by hand).",
        );
        return 1;
      }
      return 0;
    } finally {
      lock.release();
    }
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entrypoint (`bun scripts/rdv-supervision.ts <command> [...]`)
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  const deps = realDeps();
  const paths = supervisionPaths(process.env);
  const projectRoot = process.env.DEPLOY_PROJECT_ROOT || join(import.meta.dir, "..");

  let code = 0;
  try {
  switch (command) {
    case "watchdog-act": {
      const reason = rest.filter((a) => !a.startsWith("--")).join(" ") || "unspecified";
      const maxFailures = parseInt(process.env.MAX_FAILURES || "", 10);
      code = await watchdogAct(deps, paths, reason, {
        maxFailures: Number.isInteger(maxFailures) && maxFailures > 0 ? maxFailures : undefined,
        projectRoot,
      });
      break;
    }
    case "doctor-supervision": {
      code = await doctorSupervision(deps, paths, {
        forceReclaim: rest.includes("--force-reclaim"),
      });
      break;
    }
    default:
      console.log(`
Remote Dev Supervision Core

Usage: bun scripts/rdv-supervision.ts <command>

Commands:
  watchdog-act <reason>              Run the watchdog recovery transaction
                                     (control-locked; called by watchdog.sh)
  doctor-supervision                 Print supervision state
  doctor-supervision --force-reclaim Reclaim prior generations with explicit
                                     operator consent (tolerates corrupt
                                     manifests by archiving them aside)
`);
      code = command ? 1 : 0;
  }
  } catch (err) {
    // Unreadable supervision evidence is fail-closed at every entry point,
    // including this one — never a silent success.
    if (err instanceof SupervisionEvidenceError) {
      console.error(`[supervision] EVIDENCE UNAVAILABLE: ${err.message}`);
      console.error("[supervision] refusing to act; fix the filesystem condition, then retry.");
      code = 1;
    } else {
      throw err;
    }
  }
  process.exit(code);
}
