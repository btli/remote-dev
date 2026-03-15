/**
 * Next.js instrumentation file - runs once when the server starts
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on server (not edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
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
  }
}
