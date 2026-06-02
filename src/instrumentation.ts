/**
 * Next.js instrumentation file - runs once when the server starts
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on server (not edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Snapshot runtime-only env (AUTH_SECRET / AUTH_URL / RDV_INSTANCE_SLUG)
    // into globalThis BEFORE anything else. In Next standalone the proxy (Node
    // middleware) can't reliably read these from process.env; it falls back to
    // this snapshot via @/lib/runtime-env. Runs in the same process + globalThis
    // that later loads the proxy bundle, and before any request is served.
    // See src/lib/runtime-env.ts for the full rationale. No-op effect on
    // single-server (the proxy shares process.env there).
    const { captureRuntimeEnv } = await import("@/lib/runtime-env");
    captureRuntimeEnv();

    const { createLogger } = await import("@/lib/logger");
    const log = createLogger("Startup");

    // Prune old log entries (7-day retention)
    try {
      const { pruneLogsUseCase } = await import("@/infrastructure/container");
      const pruned = pruneLogsUseCase.execute();
      if (pruned > 0) {
        log.info("Pruned expired log entries", { count: pruned });
      }
    } catch (error) {
      log.error("Log pruning failed", { error: String(error) });
    }

    // Run startup cleanup for expired trash items
    log.debug("Running trash cleanup...");
    try {
      const { cleanupExpiredItems } = await import("@/services/trash-service");
      const result = await cleanupExpiredItems();
      if (result.deletedCount > 0) {
        log.info("Cleaned up expired trash items", { deletedCount: result.deletedCount });
      } else {
        log.debug("No expired trash items to clean up");
      }
    } catch (error) {
      log.error("Trash cleanup failed", { error: String(error) });
    }

    // Clean up old peer messages (24h TTL)
    try {
      const { cleanupOldMessages } = await import("@/services/peer-service");
      await cleanupOldMessages();
    } catch (error) {
      log.error("Peer message cleanup failed", { error: String(error) });
    }
  }
}
