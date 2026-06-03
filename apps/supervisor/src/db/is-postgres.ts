/**
 * Returns true when the configured DATABASE_URL targets PostgreSQL.
 *
 * Single source of truth for dialect selection in the supervisor app. The
 * generated schema barrel (src/db/schema.ts) consults this at import time to
 * pick the active dialect's table objects; src/db/index.ts uses the same check
 * to construct the matching client.
 */
export function isPostgres(): boolean {
  const u = process.env.DATABASE_URL ?? "";
  return u.startsWith("postgresql://") || u.startsWith("postgres://");
}
