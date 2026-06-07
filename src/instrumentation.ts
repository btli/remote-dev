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

    // Native-module ABI self-check (remote-dev-7wgn). Structured logging writes
    // to logs.db through better-sqlite3, and the logger swallows write errors —
    // so a NODE_MODULE_VERSION mismatch (e.g. Homebrew silently bumping Node)
    // silently disables logs.db with no obvious symptom. Actively probe the
    // addon here and, on an ABI mismatch, emit ONE loud, specific, grep-able
    // error under a dedicated namespace. This is intentionally NON-FATAL: the
    // app's main DB is libsql, so a broken logging addon must not take the app
    // down — it must just be impossible to miss.
    try {
      const { probeBetterSqlite3 } = await import("@/lib/native-module-check");
      const probe = await probeBetterSqlite3();
      if (!probe.ok && probe.abiMismatch) {
        createLogger("NativeModuleCheck").error(
          "better-sqlite3 ABI mismatch — structured logging is DISABLED (logs.db writes will silently fail); rebuild native modules against the running Node",
          {
            module: "better-sqlite3",
            nodeVersion: process.version,
            nodeModuleVersion: process.versions.modules,
            error: probe.error,
            remediation:
              "npm rebuild better-sqlite3 --build-from-source (with the runtime node on PATH), then restart",
          },
        );
      } else if (!probe.ok) {
        // Non-ABI failure (e.g. module genuinely missing) — still worth a loud
        // line, but phrased so it isn't mistaken for the ABI case.
        createLogger("NativeModuleCheck").error(
          "better-sqlite3 failed to load — structured logging to logs.db is DISABLED",
          { module: "better-sqlite3", error: probe.error },
        );
      }
    } catch (error) {
      // The probe itself must never break boot.
      log.error("Native-module self-check failed to run", {
        error: String(error),
      });
    }

    // Apply PostgreSQL migrations BEFORE any DB-touching startup work below.
    // On SQLite this is a no-op (the SQLite path uses `db:push`), so existing
    // behavior is unchanged. On Postgres a failure rethrows to fail the boot
    // loudly rather than serving a tableless app.
    const { runMigrations } = await import("@/db/migrate");
    await runMigrations();

    // Seed the `authorized_users` table from AUTHORIZED_USERS (remote-dev-sb98).
    // MUST run AFTER migrate-on-boot: on Postgres the migrate step above just
    // created the schema; on SQLite the schema already exists (the instance
    // entrypoint's pre-app bootstrap), so the table is present on both paths.
    // No-op unless AUTHORIZED_USERS is set, idempotent (onConflictDoNothing).
    // seedAuthorizedUsersFromEnv swallows TRANSIENT errors (an already-seeded
    // instance still boots) but RETHROWS the one fatal class — AUTHORIZED_USERS
    // set + schema missing — so it must propagate here to fail the boot loudly
    // (a silently-unauthorized instance is worse). We deliberately do NOT wrap it
    // in a swallowing try/catch; a dynamic-import failure also legitimately fails
    // boot, same as the migrate step above.
    const { seedAuthorizedUsersFromEnv } = await import("@/db/boot-seed");
    await seedAuthorizedUsersFromEnv();

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
