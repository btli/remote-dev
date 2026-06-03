/**
 * Migrate-on-boot for the Supervisor database (closes bd remote-dev-bqgo).
 *
 * `db:push` is a developer convenience; production fresh databases need the
 * FULL schema (the existing supervisor tables + the NextAuth identity tables)
 * applied deterministically at startup. We run the committed Drizzle migrations
 * against the active backend at boot.
 *
 * DUAL-BACKEND:
 *   - SQLite (default): apply `apps/supervisor/drizzle/` via the libsql
 *     migrator. Idempotent two ways — drizzle tracks applied migrations in
 *     `__drizzle_migrations`, and the `0000` SQL uses `CREATE TABLE/INDEX IF NOT
 *     EXISTS` so a LEGACY DB created by `db:push` (the 5 original tables, no
 *     migration history) is migrated without a "table already exists" crash.
 *   - PostgreSQL: apply `apps/supervisor/drizzle/pg/` via the node-postgres
 *     migrator. Drizzle tracks applied migrations in `drizzle.__drizzle_migrations`,
 *     so re-running on an already-migrated DB is a no-op.
 *
 * RESILIENCE: a migrate failure on a fresh DB would leave a tableless app that
 * 500s every request. We log loudly AND rethrow so the process fails fast (the
 * caller in `instrumentation.ts` lets it propagate) rather than serving a broken
 * app.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/db";
import { isPostgres } from "@/db/is-postgres";
import { createLogger } from "@/lib/logger";

const log = createLogger("db/migrate");

/**
 * Build the ordered probe list for a migrations folder, given the leaf name
 * relative to the app (`"drizzle"` for SQLite, `"drizzle/pg"` for Postgres).
 * Bundled next to the app in every shape we run:
 *   - dev (`next dev` / vitest) + controller (`bun src/controller/index.ts`):
 *     cwd is the app dir, so `<cwd>/<leaf>` is the repo `apps/supervisor/<leaf>`.
 *   - standalone image: WORKDIR is `/app/apps/supervisor` (so `<cwd>/<leaf>`
 *     resolves), and the Dockerfile ALSO copies `drizzle/` next to `server.js`
 *     at `.next/standalone/apps/supervisor/drizzle`.
 * We probe an ordered set and use the first that exists.
 */
function probeMigrationsFolder(leaf: string): string {
  const candidates: string[] = [];

  // 1) PRIMARY: relative to the process working directory. Reliable in the
  //    standalone image (WORKDIR = app dir) AND in dev/tests/the controller.
  candidates.push(join(process.cwd(), leaf));

  // 2) The standalone nesting, in case cwd is the repo/app root rather than the
  //    standalone app dir.
  candidates.push(join(process.cwd(), ".next/standalone/apps/supervisor", leaf));

  // 3) LAST RESORT: relative to this module's location (…/src/db → ../../<leaf>).
  //    Unreliable for a BUNDLED module, so it is only a fallback for the
  //    non-bundled cases (dev/tests/controller). Wrapped defensively in case a
  //    bundler strips `import.meta.url`.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(here, "../..", leaf));
  } catch {
    // import.meta.url unavailable — the cwd-based candidates above cover us.
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Default to the cwd-relative path; `migrate` will throw a clear ENOENT that
  // the caller logs + rethrows.
  return join(process.cwd(), leaf);
}

/** Locate the committed SQLite (`drizzle/`) migrations folder at runtime. */
export function resolveMigrationsFolder(): string {
  return probeMigrationsFolder("drizzle");
}

/** Locate the committed PostgreSQL (`drizzle/pg/`) migrations folder at runtime. */
export function resolvePgMigrationsFolder(): string {
  return probeMigrationsFolder("drizzle/pg");
}

/**
 * Apply all pending migrations against the active backend. Throws on hard
 * failure (after logging) so a broken migrate fails the boot loudly instead of
 * serving a tableless app.
 */
export async function runMigrations(): Promise<void> {
  if (isPostgres()) {
    await runPgMigrations();
    return;
  }

  const migrationsFolder = resolveMigrationsFolder();
  try {
    await migrate(db, { migrationsFolder });
    log.info("Database migrations applied", { migrationsFolder });
  } catch (error) {
    log.error("Database migration failed", {
      error: String(error),
      migrationsFolder,
    });
    throw error;
  }
}

/**
 * PostgreSQL migrate path. The node-postgres driver + migrator are imported
 * dynamically so they stay out of the SQLite cold path (loaded only when the
 * backend is Postgres). Uses a dedicated pool that is closed in `finally`.
 */
async function runPgMigrations(): Promise<void> {
  const migrationsFolder = resolvePgMigrationsFolder();

  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate: pgMigrate } = await import("drizzle-orm/node-postgres/migrator");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pgMigrate(drizzle(pool), { migrationsFolder });
    log.info("Database migrations applied", { migrationsFolder });
  } catch (error) {
    log.error("Database migration failed", {
      error: String(error),
      migrationsFolder,
    });
    throw error;
  } finally {
    await pool.end();
  }
}
