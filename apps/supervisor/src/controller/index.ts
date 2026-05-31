/**
 * Supervisor controller process (the second process in the two-process model,
 * spec §6.1). Long-running reconciler + capacity loop.
 *
 * The reconciler (jvcx.4) advances instances through the state machine from live
 * k8s state (§6.3) with transactional provisioning + rollback (§6.4). It is
 * implemented in `reconciler.ts` and invoked from `reconcileTick()` below. The
 * capacity loop (Phase 3) is still future work.
 *
 * Run via: `bun run dev:controller` (tsx).
 */

import { createLogger } from "@/lib/logger";
import { reconcileInstances } from "@/controller/reconciler";

const log = createLogger("Controller");

/** Reconcile cadence — 30s poll (§6.3: no Watch streams; restart-safe). */
const RECONCILE_INTERVAL_MS = 30_000;

let ticking = false;
let timer: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

/**
 * One reconcile pass: load non-terminal instances and drive each through the
 * state machine from live k8s state (requested→provisioning→ready, terminating→
 * deleted), recording transitions in the audit log.
 *
 * `reconcileInstances()` is itself resilient — a missing/unreachable cluster
 * makes it log-and-return rather than throw — but we still wrap it so an
 * unexpected error never tears down the controller process.
 */
async function reconcileTick(): Promise<void> {
  // Guard against overlapping ticks if a pass runs long.
  if (ticking) {
    log.debug("Reconcile tick skipped (previous still running)");
    return;
  }
  ticking = true;
  try {
    await reconcileInstances();
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
