/**
 * Sidecar Postgres pool.
 *
 * When `DATABASE_URL` targets Postgres, the two sidecar datasets (logs +
 * analytics) live in the SAME Postgres database as the main application data,
 * but under dedicated schemas (`logs`, `analytics`) — NOT separate databases.
 * They use their own small `pg.Pool`, separate from the main DB dialect pool,
 * so high-volume logging/analytics traffic cannot starve the application pool.
 *
 * The pool is constructed lazily (constructing a `pg.Pool` opens no connection
 * until the first query), so importing this module is cheap and side-effect
 * free beyond holding the singleton reference.
 */

import { Pool } from "pg";

let _pool: Pool | null = null;

/**
 * Get the shared sidecar Postgres pool, creating it on first use.
 *
 * @throws if `DATABASE_URL` is not set (callers only reach this on the
 *   Postgres path, where the URL is guaranteed present).
 */
export function getSidecarPool(): Pool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "getSidecarPool: DATABASE_URL is not set (sidecar pool requires Postgres)"
    );
  }

  _pool = new Pool({ connectionString, max: 5 });
  // An idle client error emits 'error' on the Pool; without a listener Node
  // crashes the process. This pool BACKS the logging/analytics sink, so we use
  // console.error directly — routing through the structured logger here would
  // recurse (the logger writes through this very pool on the Postgres path).
  _pool.on("error", (err) => {
    console.error("[sidecar-db] idle pg client error:", String(err));
  });
  return _pool;
}

/**
 * Close the sidecar pool. Called during graceful shutdown (after the sidecar
 * stores have been flushed).
 */
export async function closeSidecarPool(): Promise<void> {
  if (_pool) {
    const pool = _pool;
    _pool = null;
    await pool.end();
  }
}
