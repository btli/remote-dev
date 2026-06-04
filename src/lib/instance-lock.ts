/**
 * Instance lock — best-effort single-writer guard for the data directory.
 *
 * Two pods accidentally pointed at the same `RDV_DATA_DIR` would race on
 * SQLite WAL writes and tmux socket files, corrupting state in ways that
 * are hard to diagnose. K8s `ReadWriteOnce` PVCs already prevent multiple
 * pods from mounting concurrently — this is a belt-and-suspenders sentinel
 * for non-K8s deployments and for the brief overlap during pod restarts.
 *
 * ## When the lock engages
 *
 * The lock ONLY engages in **multi-instance mode** — i.e. when `RDV_BASE_PATH`
 * is non-empty (the env var that gives each co-hosted instance its own URL
 * prefix). In **single-host mode** (empty `RDV_BASE_PATH`: dev, Electron, and
 * self-hosted single-tenant prod) `acquireInstanceLock()` is a no-op and never
 * touches the lock file.
 *
 * Why: on single-host the lock is pure harm. The launchd/systemd watchdog and
 * the deploy/restart scripts (`rdv.ts`, `deploy.ts`) are the real single-writer
 * guard there — and they restart by killing the old server and re-spawning. A
 * restart momentarily has the old terminal server still alive while the new one
 * starts; with the lock engaged the new server's `acquireInstanceLock()` saw
 * the still-live holder and refused to start, crash-looping until the 5-min
 * age-reclaim — which then left TWO live writers on one data dir. The
 * `BASE_PATH === ""` gate disables the lock in exactly the deployments where it
 * caused this deadlock and adds no value. See remote-dev-i85i.
 *
 * Escape hatch: set `RDV_FORCE_INSTANCE_LOCK=1` to engage the lock even with an
 * empty `RDV_BASE_PATH` (tests, or unusual single-host setups that genuinely
 * run multiple writers against one data dir).
 *
 * ## Lock-file format
 *
 * The lock file at `${RDV_DATA_DIR}/instance.lock` is a JSON record:
 *
 *   { "pid": 7, "hostname": "rdv-alpha-0", "startedAt": "2026-05-19T…",
 *     "writerNonce": "<uuid>" }
 *
 * ## Why JSON, not just a PID
 *
 * In containers, every pod restart starts processes from a fresh PID
 * namespace where PID 1 (tini) is always alive. If the previous pod's
 * terminal server (PID 7) crashed without releasing the lock, a naïve
 * PID-liveness check on the new pod would see PID 7 is "alive" (it is —
 * but it's a *different* PID 7 in the new pod) and refuse to start →
 * crashloop.
 *
 * The hostname + startedAt fields disambiguate:
 *
 *   - Different `hostname` (different pod) → always stale → take over.
 *   - Same hostname + same PID + same nonce → idempotent same-process retry.
 *   - Same hostname + different PID + alive + recent (<5 min) → real
 *     conflict, refuse to start.
 *   - Same hostname + stale by age (>5 min) → take over.
 *
 * ## TOCTOU
 *
 * Two starters racing to acquire could both see no live lock and both write
 * their PID. We mitigate by including a random `writerNonce` and re-reading
 * the file after our write: if the persisted record's nonce isn't ours, we
 * lost the race and exit.
 *
 * ## Limitations
 *
 *   - Advisory, not kernel-enforced. `flock(2)` would be robust but Node has
 *     no native binding; FFI would dwarf the value. Documented in
 *     `docs/MULTI_INSTANCE.md` as a known limitation.
 *   - PID-liveness check on a different host (NFS PVC mounted from two
 *     nodes) would false-negative. Don't mount the same PVC from two
 *     hosts. RWO already enforces this in K8s.
 *
 * Call `acquireInstanceLock()` once during server startup, before any
 * writes to RDV_DATA_DIR. `releaseInstanceLock()` is called automatically
 * on `process.on('exit')` and `uncaughtException`, plus the explicit
 * shutdown handlers in `src/server/index.ts`.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { runtimeJoin as join } from "@/lib/dynamic-fs";
import { randomUUID } from "node:crypto";

import { BASE_PATH } from "@/lib/base-path";
import { createLogger } from "@/lib/logger";
import { getDataDir } from "@/lib/paths";

const log = createLogger("InstanceLock");

/**
 * Maximum age of a same-host lock before it is considered stale and
 * reclaimed. Five minutes is comfortably longer than a normal pod restart
 * (≈30s graceful shutdown + container restart) but short enough that a
 * crashloop unsticks itself quickly.
 */
const STALE_LOCK_THRESHOLD_MS = 5 * 60_000;

interface LockRecord {
  pid: number;
  hostname: string;
  /** ISO-8601 timestamp. */
  startedAt: string;
  /** Random per-acquisition nonce; TOCTOU tiebreaker. */
  writerNonce: string;
}

let heldRecord: LockRecord | null = null;
let lockPath: string | null = null;
let processHandlersRegistered = false;

/**
 * Probe whether a PID is alive on this host. POSIX `kill(pid, 0)` returns
 * 0 (Node throws nothing) when the process exists, ESRCH when not, EPERM
 * when it exists but is owned by another user. EPERM still means "alive",
 * so we treat it as such.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

/**
 * Parse the lock file. Returns null if the file is absent, unreadable, or
 * not valid JSON in the expected shape — all of which we treat as "no
 * valid lock" (caller will overwrite).
 */
function readExistingLock(path: string): LockRecord | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Partial<LockRecord>;
  if (
    typeof record.pid !== "number" ||
    typeof record.hostname !== "string" ||
    typeof record.startedAt !== "string" ||
    typeof record.writerNonce !== "string"
  ) {
    return null;
  }
  return record as LockRecord;
}

function registerProcessHandlers(): void {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;
  // `exit` fires on every termination path — normal exit, process.exit(),
  // uncaught exception after handlers run, etc. Synchronous only (no
  // promises, no setTimeout). Lock release is a single unlinkSync, so this
  // works inside `exit`.
  process.on("exit", () => {
    try {
      releaseInstanceLock();
    } catch {
      /* nothing useful to do during exit */
    }
  });
  // Re-throw after release so the default crash behavior still applies.
  process.on("uncaughtException", (err) => {
    try {
      releaseInstanceLock();
    } catch {
      /* ignore */
    }
    // Node's default uncaughtException behavior is to print + exit non-zero.
    // We re-throw here so that default kicks in (Node 22 deprecates running
    // through after a missing handler differently from listener-installed).
    log.error("Uncaught exception — releasing instance lock and exiting", { error: String(err) });
    process.exit(1);
  });
}

/**
 * Acquire the instance lock. Throws and logs if another live process
 * already owns the lock. Stale locks (dead PID, foreign host, or aged-out
 * same-host PID) are reclaimed.
 *
 * Idempotent in the same process: a second call from the same PID is a
 * no-op.
 */
export function acquireInstanceLock(): void {
  // Single-host mode (empty RDV_BASE_PATH): the lock is pure harm — process
  // management is the real single-writer guard, and the lock would deadlock
  // watchdog/deploy restarts. No-op without reading or writing the lock file.
  // RDV_FORCE_INSTANCE_LOCK=1 forces it on (tests / unusual setups).
  // BASE_PATH is resolved once at module load (see base-path.ts), so multi-instance
  // deployments must set RDV_BASE_PATH in the real process env (k8s/Docker/entrypoint),
  // not .env.local — same requirement as every other BASE_PATH consumer.
  if (BASE_PATH === "" && process.env.RDV_FORCE_INSTANCE_LOCK !== "1") {
    log.info("Instance lock skipped (single-host mode; set RDV_FORCE_INSTANCE_LOCK=1 to force)");
    return;
  }

  if (heldRecord !== null) {
    return; // already held in this process
  }

  const dataDir = getDataDir();
  const path = join(dataDir, "instance.lock");
  const ourHostname = osHostname();
  const ourRecord: LockRecord = {
    pid: process.pid,
    hostname: ourHostname,
    startedAt: new Date().toISOString(),
    writerNonce: randomUUID(),
  };

  const existing = readExistingLock(path);

  if (existing !== null) {
    // Same-host conflict path. Cross-host records (different hostname) are
    // always treated as stale — RWO PVCs prevent two hosts from mounting
    // the same volume in K8s, so a foreign hostname means the file was
    // left over from a previous pod that is no longer running here.
    if (existing.hostname === ourHostname) {
      // Same hostname + same PID + matching nonce ⇒ idempotent re-acquire.
      // (Nonce check guards against PID reuse across server restarts on the
      // same host within the same process-table generation.)
      if (existing.pid === process.pid && existing.writerNonce === ourRecord.writerNonce) {
        // Effectively unreachable since we just generated a fresh nonce,
        // but be defensive — treat as already-held.
        heldRecord = existing;
        lockPath = path;
        return;
      }
      const startedAtMs = Date.parse(existing.startedAt);
      const ageMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : Number.POSITIVE_INFINITY;
      const isAlive = isPidAlive(existing.pid);
      if (isAlive && ageMs < STALE_LOCK_THRESHOLD_MS) {
        log.error("Refusing to start: another rdv process owns this data dir", {
          lockPath: path,
          existingPid: existing.pid,
          existingStartedAt: existing.startedAt,
          hostname: ourHostname,
        });
        throw new Error(
          `Instance lock at ${path} is held by PID ${existing.pid} on host ${existing.hostname} ` +
            `(started ${existing.startedAt}). Refusing to start a second writer against the same RDV_DATA_DIR.`,
        );
      }
      log.warn("Reclaiming stale instance lock", {
        lockPath: path,
        stalePid: existing.pid,
        staleHostname: existing.hostname,
        staleStartedAt: existing.startedAt,
        ageMs,
        pidAlive: isAlive,
      });
    } else {
      log.warn("Reclaiming instance lock from a different host (stale across pod restart)", {
        lockPath: path,
        previousHostname: existing.hostname,
        previousPid: existing.pid,
        previousStartedAt: existing.startedAt,
        ourHostname,
      });
    }
  }

  // Acquire by writing our record. Use `writeFileSync` with mode 0o600 so
  // a subsequent reader can verify the nonce.
  writeFileSync(path, JSON.stringify(ourRecord), { mode: 0o600 });

  // TOCTOU verification: re-read and confirm our nonce won. If a competing
  // starter wrote between our existence-check and our write, the file now
  // contains their record instead of ours and we should bail.
  const verified = readExistingLock(path);
  if (verified === null || verified.writerNonce !== ourRecord.writerNonce) {
    log.error("Lost race for instance lock", {
      lockPath: path,
      winner: verified,
    });
    throw new Error(
      `Instance lock at ${path} was claimed by a concurrent starter during acquisition (TOCTOU). ` +
        "Refusing to start a second writer against the same RDV_DATA_DIR.",
    );
  }

  heldRecord = ourRecord;
  lockPath = path;
  registerProcessHandlers();
  log.info("Acquired instance lock", { lockPath: path, record: ourRecord });
}

/**
 * Release the instance lock. Safe to call multiple times. Wired into the
 * shutdown handlers in `src/server/index.ts` and the automatic `exit` /
 * `uncaughtException` handlers above.
 *
 * Defensively only deletes the lock file when its on-disk nonce matches
 * the one we wrote — so a stray `releaseInstanceLock()` after another pod
 * has already taken over doesn't delete the new owner's lock.
 */
export function releaseInstanceLock(): void {
  const record = heldRecord;
  const path = lockPath;
  heldRecord = null;
  lockPath = null;
  if (record === null || path === null) return;
  try {
    const onDisk = readExistingLock(path);
    if (onDisk !== null && onDisk.writerNonce !== record.writerNonce) {
      log.warn("Not deleting instance lock — file is now owned by another writer", {
        lockPath: path,
        ourNonce: record.writerNonce,
        currentOwner: onDisk,
      });
      return;
    }
    unlinkSync(path);
  } catch {
    // ignore — file may already be gone, or the directory may have been
    // unmounted under us during shutdown.
  }
}

/**
 * Test-only escape hatch: reset the in-memory held-record so the next
 * `acquireInstanceLock()` call goes through the full acquire path.
 * Not exported for production use.
 *
 * @internal
 */
export function __resetInstanceLockForTests(): void {
  heldRecord = null;
  lockPath = null;
}
