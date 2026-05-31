/**
 * Supervisor controller process (the second process in the two-process model,
 * spec §6.1). Long-running reconciler + capacity loop.
 *
 * SCAFFOLD ONLY: this is a no-op reconcile loop that ticks every
 * RECONCILE_INTERVAL_MS and logs. The real reconciler — advancing instances
 * through the state machine from live k8s state (§6.3), transactional
 * provisioning + rollback (§6.4), and the capacity loop (Phase 3) — lands in
 * jvcx.4+. It plugs in at `reconcileTick()` below.
 *
 * Run via: `bun run dev:controller` (tsx).
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("Controller");

/** Reconcile cadence — 30s poll (§6.3: no Watch streams; restart-safe). */
const RECONCILE_INTERVAL_MS = 30_000;

let ticking = false;
let timer: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

/**
 * One reconcile pass. No-op until jvcx.4.
 *
 * When implemented this will: load instances from the DB, query live k8s state,
 * and drive each instance's state machine (requested→provisioning→ready, etc.),
 * recording transitions in the audit log.
 */
async function reconcileTick(): Promise<void> {
  // Guard against overlapping ticks if a future implementation runs long.
  if (ticking) {
    log.debug("Reconcile tick skipped (previous still running)");
    return;
  }
  ticking = true;
  try {
    log.info("reconcile tick", { intervalMs: RECONCILE_INTERVAL_MS });
    // TODO(jvcx.4): reconcile instances against live cluster state.
  } catch (error) {
    log.error("reconcile tick failed", { error: String(error) });
  } finally {
    ticking = false;
  }
}

function start(): void {
  log.info("Supervisor controller starting", {
    intervalMs: RECONCILE_INTERVAL_MS,
  });
  // Kick an immediate tick, then poll on the interval.
  void reconcileTick();
  timer = setInterval(() => void reconcileTick(), RECONCILE_INTERVAL_MS);
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Supervisor controller shutting down", { signal });
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // Wait (up to 5s) for any in-flight reconcile tick to settle before exit.
  // Matters once jvcx.4 adds real work that shouldn't be torn out mid-flight.
  const deadline = Date.now() + 5_000;
  while (ticking && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (ticking) log.warn("Exiting with a reconcile tick still in flight");
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

start();
