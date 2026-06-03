/**
 * Vitest globalSetup for the PostgreSQL integration suite (Unit 11 B/C).
 *
 * HARNESS APPROACH — TESTCONTAINERS (this is the path that worked under bun).
 * `@testcontainers/postgresql` starts a real `postgres:alpine` container in
 * ~1s under bun (verified: container start -> host pg connect -> query -> stop
 * all succeed). No docker-run fallback was needed; the testcontainers client
 * talks to the local Docker daemon (Docker 29.5) directly. The earlier apparent
 * "hang" while smoke-testing was purely a shell `| tail` pipe buffering
 * artifact, NOT a testcontainers problem.
 *
 * What this does:
 *   1. Start one shared `postgres:alpine` container for the whole run.
 *   2. Apply the main `drizzle/pg` migrations into the container's `public`
 *      schema via the node-postgres migrator, so the container is in a known,
 *      fully-migrated baseline state. (Per-test isolation re-applies the DDL
 *      into a fresh `test_<unique>` schema — see get-test-db.ts.)
 *   3. Expose `process.env.TEST_PG_URL` = the container connection URI.
 *
 * Teardown stops the container (and the testcontainers Ryuk reaper removes it
 * even if the process is killed), so `docker ps -a` shows no leftovers.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";

let container: StartedPostgreSqlContainer | undefined;

const PG_MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle/pg");

export async function setup(): Promise<void> {
  // We explicitly stop+remove the container in `teardown()`, so the Ryuk reaper
  // (a long-lived singleton container) is redundant. Disabling it guarantees a
  // clean `docker ps -a` after the run — no leftover reaper container.
  process.env.TESTCONTAINERS_RYUK_DISABLED = "true";

  container = await new PostgreSqlContainer("postgres:alpine").start();
  const uri = container.getConnectionUri();

  // Apply the main pg migrations into the container's default (public) schema
  // so the baseline is fully migrated. Per-test schemas re-apply the DDL.
  const pool = new Pool({ connectionString: uri });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: PG_MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }

  process.env.TEST_PG_URL = uri;
}

export async function teardown(): Promise<void> {
  if (container) {
    await container.stop({ remove: true });
    container = undefined;
  }
}
