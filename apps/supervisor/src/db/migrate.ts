/**
 * Migrate-on-boot for the Supervisor database (closes bd remote-dev-bqgo).
 *
 * `db:push` is a developer convenience; production fresh PVCs need the FULL
 * schema (the existing supervisor tables + the new NextAuth identity tables)
 * applied deterministically at startup. We run the committed Drizzle migrations
 * from `apps/supervisor/drizzle/` against the libsql client at boot.
 *
 * RESILIENCE: a migrate failure on a fresh DB would leave a tableless app that
 * 500s every request. We log loudly AND rethrow so the process fails fast (the
 * caller in `instrumentation.ts` lets it propagate) rather than serving a broken
 * app. Migrations are idempotent two ways: drizzle tracks applied ones in
 * `__drizzle_migrations` (re-running on an already-migrated DB is a no-op), and
 * the `0000` SQL uses `CREATE TABLE/INDEX IF NOT EXISTS` so a LEGACY DB created
 * by `db:push` (the 5 original tables, but NO migration history) is migrated
 * without a "table already exists" crash — the 5 existing tables are skipped and
 * only the 4 new NextAuth tables are created.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("db/migrate");

/**
 * Locate the committed `drizzle/` migrations folder at runtime. Bundled next to
 * the app in every shape we run:
 *   - dev (`next dev` / vitest) + controller (`bun src/controller/index.ts`):
 *     cwd is the app dir, so `<cwd>/drizzle` is the repo `apps/supervisor/drizzle`.
 *   - standalone image: WORKDIR is `/app/apps/supervisor` (so `<cwd>/drizzle`
 *     resolves), and the Dockerfile ALSO copies `drizzle/` next to `server.js`
 *     at `.next/standalone/apps/supervisor/drizzle`.
 * We probe an ordered set and use the first that exists.
 */
export function resolveMigrationsFolder(): string {
  const candidates: string[] = [];

  // 1) PRIMARY: relative to the process working directory. This is the reliable
  //    path in the standalone image (WORKDIR = app dir) AND in dev/tests/the
  //    controller (cwd = app dir). Prefer it over the module-relative path.
  candidates.push(join(process.cwd(), "drizzle"));

  // 2) The standalone nesting, in case cwd is the repo/app root rather than the
  //    standalone app dir.
  candidates.push(
    join(process.cwd(), ".next/standalone/apps/supervisor/drizzle"),
  );

  // 3) LAST RESORT: relative to this module's location (…/src/db → ../../drizzle).
  //    Unreliable for a BUNDLED module — under `output: "standalone"` this file
  //    is traced into `.next/server/...`, where `../../drizzle` does not point at
  //    the migrations — so it is only a fallback for the non-bundled cases
  //    (dev/tests/controller). Wrapped defensively in case a bundler strips
  //    `import.meta.url`.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(here, "../../drizzle"));
  } catch {
    // import.meta.url unavailable — the cwd-based candidates above cover us.
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Default to the cwd-relative path; `migrate` will throw a clear ENOENT that
  // the caller logs + rethrows.
  return join(process.cwd(), "drizzle");
}

/**
 * Apply all pending migrations. Throws on hard failure (after logging) so a
 * broken migrate fails the boot loudly instead of serving a tableless app.
 */
export async function runMigrations(): Promise<void> {
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
