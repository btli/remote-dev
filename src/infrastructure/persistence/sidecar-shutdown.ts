/**
 * Graceful-shutdown flush + close for the Next.js process's sidecar write paths.
 *
 * WHY THIS MODULE EXISTS (edge-bundle isolation):
 * `src/instrumentation.ts` is compiled for BOTH the Node and the Edge runtimes.
 * The sidecar stores reach `pg` (and the SQLite path reaches `better-sqlite3`),
 * neither of which can be bundled for the Edge runtime (`pg` needs the Node-only
 * `util/types`). Turbopack edge-traces this module from instrumentation, so it
 * MUST have NO top-level imports that transitively reach `pg` /
 * `better-sqlite3` — even `@/lib/logger` is off-limits at the top level because
 * it statically reaches the sidecar factory (AppLogger → getLogStore).
 *
 * Therefore EVERY dependency (including the logger) is loaded with a lazy
 * dynamic `await import()` inside the function body. The module's top level is
 * empty of imports, so the edge tracer finds nothing to pull in.
 *
 * Mirrors the ordering in `src/server/index.ts` (the terminal server): flush the
 * sidecar stores, then close the sidecar pool. On SQLite the sidecar flush /
 * pool-close are no-ops; we also close the better-sqlite3 log/analytics
 * databases (idempotent, no-op if never opened). We deliberately do NOT call
 * `process.exit` — Next.js owns its own shutdown sequence; we only drain.
 */

export async function flushSidecarsOnShutdown(signal: string): Promise<void> {
  const { createLogger } = await import("@/lib/logger");
  const log = createLogger("Shutdown");
  log.info("Flushing sidecar stores before shutdown", { signal });

  // Drain the Postgres sidecar write buffers (logs + analytics), then close the
  // sidecar pool. No-op on SQLite (nothing buffered; the sidecar pool is never
  // created).
  try {
    const { flushSidecarStores } = await import("./sidecar-factory");
    await flushSidecarStores();
    const { closeSidecarPool } = await import("./pg/sidecar-db");
    await closeSidecarPool();
  } catch (error) {
    log.error("Error flushing/closing Postgres sidecar stores", {
      error: String(error),
    });
  }

  // SQLite path: close the better-sqlite3 log/analytics databases (no-op on the
  // Postgres path / if never opened).
  try {
    const { closeAnalyticsDatabase } = await import(
      "@/infrastructure/analytics/AnalyticsDatabase"
    );
    closeAnalyticsDatabase();
  } catch {
    /* ignore */
  }
  try {
    const { closeLogDatabase } = await import(
      "@/infrastructure/logging/LogDatabase"
    );
    closeLogDatabase();
  } catch {
    /* ignore */
  }
}
