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
 * FAIL-OPEN: if the deadline passes without readiness we log loudly and RETURN
 * (never throw, never hang boot forever). Services then start as they do today —
 * never worse than the pre-fix behavior.
 */

import { readdirSync } from "node:fs";
import { isPostgres } from "@/db/is-postgres";
import { createLogger } from "@/lib/logger";
import { resolvePgMigrationsFolder } from "@/db/migrate";

const log = createLogger("db/schema-ready");

/** Default upper bound on how long we wait for the schema before failing open. */
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
 * Block until the PostgreSQL schema is fully migrated. No-op on SQLite.
 *
 * On Postgres, polls `drizzle.__drizzle_migrations` until the applied-migration
 * row count reaches the number of committed migrations in `drizzle/pg/`. Fails
 * open (logs + returns) after `timeoutMs` so it can never wedge boot.
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

  // Dynamic import keeps `pg` + the node-postgres driver off the SQLite cold
  // path (it is only loaded when the backend is Postgres). Mirrors migrate.ts.
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const startedAt = Date.now();
  let delay = INITIAL_POLL_DELAY_MS;
  let applied = 0;

  try {
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const res = await pool.query<{ c: number }>(
          "SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations"
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

      await sleep(delay);
      delay = Math.min(delay * 2, MAX_POLL_DELAY_MS);
    }

    // Fail-open: deadline reached without readiness. Log loudly and return so
    // services start as they do today (never worse than pre-fix).
    log.error("Timed out waiting for PostgreSQL schema — starting services anyway", {
      applied,
      expected,
      timeoutMs,
    });
  } finally {
    await pool.end();
  }
}
