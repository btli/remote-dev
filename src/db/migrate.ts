/**
 * Migrate-on-boot for the PostgreSQL backend (dual-backend feature, Unit 4).
 *
 * DIALECT SPLIT:
 *   - SQLite (default): NO migrate-on-boot. The SQLite path keeps using
 *     `db:push` as it does today (`runMigrations` is a no-op). This preserves
 *     the existing local/single-host behavior byte-for-byte.
 *   - PostgreSQL: production fresh databases (e.g. a CNPG cluster's empty DB)
 *     need the FULL schema applied deterministically at startup. We run the
 *     committed Drizzle migrations from `drizzle/pg/` against a node-postgres
 *     pool at boot.
 *
 * RESILIENCE: a migrate failure on a fresh DB would leave a tableless app that
 * 500s every request. We log loudly AND rethrow so the process fails fast (the
 * caller in `instrumentation.ts` lets it propagate) rather than serving a broken
 * app. Drizzle tracks applied migrations in `drizzle.__drizzle_migrations`, so
 * re-running on an already-migrated DB is a no-op.
 */

import { existsSync } from "node:fs";
import { runtimeJoin as join } from "@/lib/dynamic-fs";
import { isPostgres } from "@/db/is-postgres";
import { createLogger } from "@/lib/logger";

const log = createLogger("db/migrate");

/**
 * Locate the committed `drizzle/pg/` migrations folder at runtime. Probe an
 * ordered set and use the first that exists:
 *   - dev (`next dev` / vitest) + terminal server (`tsx src/server/index.ts`):
 *     cwd is the repo root, so `<cwd>/drizzle/pg` resolves.
 *   - standalone image: the Dockerfile copies `drizzle/` (incl. `drizzle/pg`)
 *     into the image; depending on cwd the standalone-nested path may apply.
 * Mirrors the pattern in apps/supervisor/src/db/migrate.ts.
 */
export function resolvePgMigrationsFolder(): string {
  const candidates = [
    // PRIMARY: relative to the process working directory. Reliable in dev,
    // tests, the terminal server, and the standalone image (WORKDIR = app dir).
    join(process.cwd(), "drizzle/pg"),
    // The standalone nesting, in case cwd is the repo root rather than the
    // standalone app dir.
    join(process.cwd(), ".next/standalone/drizzle/pg"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Default to the cwd-relative path; `migrate` will throw a clear ENOENT that
  // the caller logs + rethrows.
  return join(process.cwd(), "drizzle/pg");
}

/**
 * Apply all pending PostgreSQL migrations. No-op on SQLite (which uses
 * `db:push`). Throws on hard failure (after logging) so a broken migrate fails
 * the boot loudly instead of serving a tableless app.
 */
export async function runMigrations(): Promise<void> {
  // SQLite path: do NOT change existing behavior — `db:push` owns the schema.
  if (!isPostgres()) return;

  const migrationsFolder = resolvePgMigrationsFolder();

  // Dynamic imports keep `pg` + the node-postgres driver out of the SQLite
  // bundle / cold path (they are only loaded when the backend is Postgres).
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    log.info("PostgreSQL migrations applied", { migrationsFolder });
  } catch (error) {
    log.error("PostgreSQL migration failed", {
      error: String(error),
      migrationsFolder,
    });
    throw error;
  } finally {
    await pool.end();
  }
}
