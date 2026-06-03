/**
 * Next.js instrumentation file - runs once when the server starts
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on server (not edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { createLogger } = await import("@/lib/logger");
    const log = createLogger("Startup");

    // Apply PostgreSQL migrations BEFORE any DB-touching startup work below.
    // On SQLite this is a no-op (the SQLite path uses `db:push`), so existing
    // behavior is unchanged. On Postgres a failure rethrows to fail the boot
    // loudly rather than serving a tableless app.
    const { runMigrations } = await import("@/db/migrate");
    await runMigrations();

    // On the Postgres path, the sidecar datasets (logs + analytics) live in the
    // SAME database under dedicated `logs` / `analytics` schemas. Bootstrap them
    // idempotently right after the main-DB migrations. No-op on SQLite (those
    // sidecars use their own better-sqlite3 files, created on first connect).
    try {
      const { isPostgres } = await import("@/db/is-postgres");
      if (isPostgres()) {
        const { initSidecarSchemas } = await import(
          "@/infrastructure/persistence/pg/sidecar-schema"
        );
        await initSidecarSchemas();
      }
    } catch (error) {
      log.error("Sidecar schema bootstrap failed", { error: String(error) });
      throw error;
    }

    // Prune old log entries (7-day retention)
    try {
      const { pruneLogsUseCase } = await import("@/infrastructure/container");
      const pruned = await pruneLogsUseCase.execute();
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
