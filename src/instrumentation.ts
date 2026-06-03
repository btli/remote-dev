/**
 * Next.js instrumentation file - runs once when the server starts
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

/**
 * Guard so the shutdown flush is registered at most once and runs at most once
 * even if both SIGTERM and SIGINT fire. Plain module-scope primitives — no
 * edge-incompatible imports.
 */
let shutdownHandlersRegistered = false;
let shutdownFlushed = false;

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

    const { isPostgres } = await import("@/db/is-postgres");
    if (isPostgres()) {
      // On the Postgres path, the sidecar datasets (logs + analytics) live in
      // the SAME database under dedicated `logs` / `analytics` schemas.
      // Bootstrap them idempotently right after the main-DB migrations.
      try {
        const { initSidecarSchemas } = await import(
          "@/infrastructure/persistence/pg/sidecar-schema"
        );
        await initSidecarSchemas();
      } catch (error) {
        log.error("Sidecar schema bootstrap failed", { error: String(error) });
        throw error;
      }

      // Drain the Postgres sidecar write buffers (logger + litellm webhook) that
      // live in THIS Next.js process on shutdown — they would otherwise lose
      // buffered rows (the terminal server drains its own copies in
      // src/server/index.ts). Handlers are registered ONLY on the Postgres path:
      // it is the only backend with an async buffer to flush (SQLite sidecar
      // writes are synchronous, so there is nothing to drain). On SQLite we add
      // NO signal handler and leave the process's existing shutdown behavior
      // completely untouched. After flushing we RE-RAISE the signal so Next.js's
      // own handler (or Node's default action) still terminates the process —
      // a listener that only drains would override Node's default-terminate and
      // hang the restart. Idempotent: handlers register once; the flush runs at
      // most once. The flush module is loaded lazily on signal so its Node-only
      // deps (pg / better-sqlite3) never enter the edge bundle.
      if (!shutdownHandlersRegistered) {
        shutdownHandlersRegistered = true;
        const onShutdown = async (signal: NodeJS.Signals): Promise<void> => {
          if (!shutdownFlushed) {
            shutdownFlushed = true;
            try {
              const { flushSidecarsOnShutdown } = await import(
                "@/infrastructure/persistence/sidecar-shutdown"
              );
              await flushSidecarsOnShutdown(signal);
            } catch (error) {
              log.error("Sidecar shutdown flush failed", {
                error: String(error),
              });
            }
          }
          // Re-raise so normal shutdown proceeds (Next.js's handler or Node's
          // default terminate). Our once-listener is already removed, so this
          // does not recurse.
          process.kill(process.pid, signal);
        };
        process.once("SIGTERM", () => void onShutdown("SIGTERM"));
        process.once("SIGINT", () => void onShutdown("SIGINT"));
      }
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
