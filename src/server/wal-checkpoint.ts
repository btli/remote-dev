/**
 * WAL auto-truncate (SQLite only).
 *
 * The SQLite WAL grows with write volume and is only shrunk by a checkpoint. A
 * 2.1 GB WAL that had never been TRUNCATE-checkpointed once amplified write
 * contention into SQLITE_BUSY. The terminal server (single owner) runs a
 * periodic `PRAGMA wal_checkpoint(TRUNCATE)` to keep it bounded. No-op on
 * Postgres (no WAL of ours to manage).
 *
 * Only the terminal server calls this — do NOT wire it into Next.js (two
 * checkpointers against one db buys nothing and just contends).
 */
import { isPostgres } from "@/db/is-postgres";
import { checkpointWal } from "@/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("WalCheckpoint");

/** How often the WAL is checkpointed (5 minutes). */
const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
/** Small delay before the first checkpoint so it never competes with boot. */
const WAL_CHECKPOINT_INITIAL_DELAY_MS = 30 * 1000;

/** Run one checkpoint, swallowing + logging any error. */
async function runOnce(): Promise<void> {
  if (isPostgres() || !checkpointWal) return;
  try {
    const r = await checkpointWal();
    log.debug("WAL checkpoint tick", {
      busy: r.busy,
      log: r.log,
      checkpointed: r.checkpointed,
    });
  } catch (error) {
    log.warn("WAL checkpoint failed", { error: String(error) });
  }
}

/**
 * Start the periodic WAL checkpoint. Returns the interval handle (or null on
 * Postgres / when unavailable). The timer is `.unref()`-ed so it never keeps
 * the process alive on its own.
 */
export function startWalCheckpointTimer(): ReturnType<typeof setInterval> | null {
  if (isPostgres() || !checkpointWal) {
    log.debug("WAL checkpoint timer not started (non-SQLite dialect)");
    return null;
  }

  // First checkpoint shortly after startup.
  const initial = setTimeout(() => void runOnce(), WAL_CHECKPOINT_INITIAL_DELAY_MS);
  initial.unref();

  const timer = setInterval(() => void runOnce(), WAL_CHECKPOINT_INTERVAL_MS);
  timer.unref();
  log.info("WAL checkpoint timer started", { intervalMs: WAL_CHECKPOINT_INTERVAL_MS });
  return timer;
}
