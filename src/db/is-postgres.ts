/**
 * Returns true when the configured DATABASE_URL targets PostgreSQL.
 *
 * Single source of truth for dialect selection. The generated schema barrel
 * (src/db/schema.ts) consults this at import time to pick the active dialect's
 * table objects; a later unit wires the same check into src/db/index.ts.
 */
export function isPostgres(): boolean {
  const u = process.env.DATABASE_URL ?? "";
  return u.startsWith("postgresql://") || u.startsWith("postgres://");
}
