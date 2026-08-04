/**
 * Postgres-only schema-readiness gate for the terminal server (remote-dev-snap).
 *
 * WHY: an instance runs TWO processes — the Next.js process and a separate
 * terminal server (`src/server/index.ts`). On a freshly-provisioned PostgreSQL
 * instance's FIRST boot, the Next.js process applies the schema via
 * migrate-on-boot (`src/instrumentation.ts` → `runMigrations()` in
 * `src/db/migrate.ts`). The terminal server starts CONCURRENTLY and immediately
 * starts DB-touching services (schedulers, auto-update recovery, litellm
 * autostart) that query tables (`session_schedule`, `litellm_config`, …) which
 * do not exist yet. Those queries hit "relation does not exist", the scheduler
 * subsystem goes unhealthy, the terminal server's `/health` returns 503, and
 * `/api/readyz` stays 503 — the pod is stuck unready until a manual restart
 * happens to land after the schema is present. This gate makes the terminal
 * server WAIT for the schema before starting those services, so it self-heals
 * with no restart.
 *
 * DIALECT SPLIT (mirrors src/db/migrate.ts):
 *   - SQLite (default): strict NO-OP. The schema is owned by `db:push` and is
 *     present before the process starts, so there is no cross-process race.
 *     `waitForSchemaReady()` returns immediately — zero behavior change, and
 *     `pg` is never imported on the SQLite cold path.
 *   - PostgreSQL: block until the schema is fully migrated, then return.
 *
 * READINESS SIGNAL: drizzle records one row in `drizzle.__drizzle_migrations`
 * per applied migration. We consider the schema ready once that row count is
 * ≥ the number of committed migrations in `drizzle/pg/` (counted dynamically via
 * `resolvePgMigrationsFolder()` + `readdirSync`, NOT hardcoded). This is
 * decoupled from any specific table name and proves ALL migrations ran.
 *
 * FAIL-CLOSED: if the deadline passes without readiness we reject startup. The
 * process supervisor can retry, but no DB-backed terminal or lifecycle endpoint
 * is exposed against a schema that is known to be incomplete.
 */

import { readdirSync } from "node:fs";
import { isPostgres } from "@/db/is-postgres";
import { createLogger } from "@/lib/logger";
import { resolvePgMigrationsFolder } from "@/db/migrate";

const log = createLogger("db/schema-ready");

/** Default upper bound on how long we wait before failing startup closed. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Backoff bounds for the readiness poll loop. */
const INITIAL_POLL_DELAY_MS = 200;
const MAX_POLL_DELAY_MS = 2_000;

/**
 * Count the committed PostgreSQL migration files in `drizzle/pg/`.
 * Exported for tests so the readiness-poll expectation stays in sync with the
 * actual migration count (rather than hard-coding a number).
 */
export function countCommittedPgMigrations(): number {
  const folder = resolvePgMigrationsFolder();
  return readdirSync(folder).filter((name) => name.endsWith(".sql")).length;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Await an operation only while the startup deadline still has budget. The pg
 * driver's timeout options protect the real socket/query; this second bound is
 * intentional defense in depth for a driver call that never settles.
 */
function settleWithin<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("PostgreSQL schema readiness probe timed out")),
      Math.max(0, timeoutMs),
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Block until the PostgreSQL schema is fully migrated. No-op on SQLite.
 *
 * On Postgres, polls `drizzle.__drizzle_migrations` until the applied-migration
 * row count reaches the number of committed migrations in `drizzle/pg/`. Rejects
 * after `timeoutMs` so a supervisor retry cannot expose a partial schema.
 */
export async function waitForSchemaReady(opts?: {
  timeoutMs?: number;
}): Promise<void> {
  // SQLite path: strict no-op. The schema is present before the process starts
  // (`db:push`), so there is no race. Do NOT import `pg`; do NOT log.
  if (!isPostgres()) return;

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const expected = countCommittedPgMigrations();

  // No committed migrations to wait for — nothing to gate on. Warn and return
  // rather than blocking forever on a count that can never be reached.
  if (expected === 0) {
    log.warn("No committed PostgreSQL migrations found — skipping schema-ready wait");
    return;
  }

  log.info("Waiting for PostgreSQL schema migration to complete...", { expected });

  const startedAt = Date.now();
  const deadline = startedAt + Math.max(0, timeoutMs);
  // Bound the driver's own connection and query work as well as the outer
  // readiness loop. Keeping each probe short also lets a recovered database be
  // observed before the overall startup deadline expires.
  const probeTimeoutMs = Math.max(1, Math.min(timeoutMs, MAX_POLL_DELAY_MS));

  // Dynamic import keeps `pg` + the node-postgres driver off the SQLite cold
  // path (it is only loaded when the backend is Postgres). Mirrors migrate.ts.
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: probeTimeoutMs,
    query_timeout: probeTimeoutMs,
    statement_timeout: probeTimeoutMs,
  });

  let delay = INITIAL_POLL_DELAY_MS;
  let applied = 0;

  try {
    while (Date.now() < deadline) {
      const remainingBeforeProbe = deadline - Date.now();
      if (remainingBeforeProbe <= 0) break;
      try {
        const res = await settleWithin(
          pool.query<{ c: number }>(
            "SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations",
          ),
          remainingBeforeProbe,
        );
        applied = res.rows[0]?.c ?? 0;
        if (applied >= expected) {
          log.info("PostgreSQL schema ready", {
            applied,
            expected,
            elapsedMs: Date.now() - startedAt,
          });
          return;
        }
      } catch {
        // The migrations table does not exist yet ("relation ... does not
        // exist") or the DB is briefly unreachable — both mean "not ready,
        // keep waiting". Swallow and retry until the deadline.
      }

      const remainingAfterProbe = deadline - Date.now();
      if (remainingAfterProbe <= 0) break;
      await sleep(Math.min(delay, remainingAfterProbe));
      delay = Math.min(delay * 2, MAX_POLL_DELAY_MS);
    }

    log.error("Timed out waiting for PostgreSQL schema — refusing terminal startup", {
      applied,
      expected,
      timeoutMs,
    });
    throw new Error(
      `Timed out waiting for PostgreSQL schema (${applied}/${expected} migrations applied)`,
    );
  } finally {
    const close = pool.end();
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await settleWithin(close, remaining).catch(() => undefined);
    } else {
      // A timed-out in-flight probe may keep Pool.end() pending until the pg
      // driver's own bounded query timeout fires. Do not let cleanup silently
      // extend the public startup deadline.
      void close.catch(() => undefined);
    }
  }
}
