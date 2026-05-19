/**
 * Instance lock — best-effort single-writer guard for the data directory.
 *
 * Two pods accidentally pointed at the same `RDV_DATA_DIR` would race on
 * SQLite WAL writes and tmux socket files, corrupting state in ways that
 * are hard to diagnose. K8s `ReadWriteOnce` PVCs already prevent multiple
 * pods from mounting concurrently — this is a belt-and-suspenders sentinel
 * for non-K8s deployments and for the brief overlap during pod restarts.
 *
 * Implementation: sentinel file at `${RDV_DATA_DIR}/instance.lock` whose
 * contents are the writer's PID. On acquire:
 *
 *   - if the file exists and the recorded PID is alive  → fail loudly
 *   - if the file exists but the PID is dead (stale lock) → take it over
 *   - if the file doesn't exist → create it
 *
 * Limitations:
 *   - This is advisory, not enforced by the kernel. `flock(2)` would be
 *     robust but Node has no native binding; we'd need an FFI dep that
 *     would dwarf the value here. Document the limitation in
 *     `docs/MULTI_INSTANCE.md` instead.
 *   - PID-liveness check on a different host (NFS PVC mounted from two
 *     nodes) would false-negative. Don't mount the same PVC from two
 *     hosts. RWO already enforces this in K8s.
 *
 * Call `acquireInstanceLock()` once during server startup, before any
 * writes to RDV_DATA_DIR. Call `releaseInstanceLock()` on shutdown.
 */

import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

import { createLogger } from "@/lib/logger";
import { getDataDir } from "@/lib/paths";

const log = createLogger("InstanceLock");

let lockFd: number | null = null;
let lockPath: string | null = null;

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
 * Acquire the instance lock. Throws and logs if another live process
 * already owns the lock. Stale locks (dead PID) are reclaimed.
 *
 * Idempotent in the same process: a second call from the same PID is a
 * no-op.
 */
export function acquireInstanceLock(): void {
  if (lockFd !== null) {
    return; // already held in this process
  }

  const dataDir = getDataDir();
  const path = join(dataDir, "instance.lock");

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8").trim();
      const existingPid = Number.parseInt(raw, 10);
      if (Number.isFinite(existingPid) && existingPid !== process.pid && isPidAlive(existingPid)) {
        log.error("Refusing to start: another rdv process owns this data dir", {
          lockPath: path,
          existingPid,
        });
        throw new Error(
          `Instance lock at ${path} is held by PID ${existingPid}. ` +
            "Refusing to start a second writer against the same RDV_DATA_DIR.",
        );
      }
      log.warn("Reclaiming stale instance lock", { lockPath: path, stalePid: raw });
      try {
        unlinkSync(path);
      } catch {
        // ignore — open() below will overwrite
      }
    } catch (err) {
      // Re-throw the explicit conflict error; swallow read errors and try
      // to open below.
      if (err instanceof Error && err.message.includes("Instance lock")) {
        throw err;
      }
    }
  }

  const fd = openSync(path, "w", 0o600);
  writeSync(fd, `${process.pid}\n`);
  lockFd = fd;
  lockPath = path;
  log.info("Acquired instance lock", { lockPath: path, pid: process.pid });
}

/**
 * Release the instance lock. Safe to call multiple times. Wired into the
 * shutdown handlers in `src/server/index.ts`.
 */
export function releaseInstanceLock(): void {
  if (lockFd !== null) {
    try {
      closeSync(lockFd);
    } catch {
      // ignore
    }
    lockFd = null;
  }
  if (lockPath !== null) {
    try {
      unlinkSync(lockPath);
    } catch {
      // ignore — lock file may already be gone
    }
    lockPath = null;
  }
}
