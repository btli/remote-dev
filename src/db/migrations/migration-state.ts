import { client } from "@/db";

const MIGRATION_STATE_TABLE = "_migration_state";

async function ensureTable() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_STATE_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
}

export async function getMigrationState(key: string): Promise<string | null> {
  await ensureTable();
  const result = await client.execute({
    sql: `SELECT value FROM ${MIGRATION_STATE_TABLE} WHERE key = ?`,
    args: [key],
  });
  const row = result.rows[0];
  if (!row) return null;
  const value = row.value;
  return typeof value === "string" ? value : null;
}

export async function setMigrationState(
  key: string,
  value: string
): Promise<void> {
  await ensureTable();
  await client.execute({
    sql: `INSERT INTO ${MIGRATION_STATE_TABLE} (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, Date.now()],
  });
}
