/**
 * One-time SQLite pre-step for the Claude account decoupling [remote-dev-n4x4.6].
 *
 * WHY THIS EXISTS
 * ---------------
 * The n4x4.6 schema change makes `claude_account.profile_id` nullable and
 * non-unique AND adds six new columns to the same table. SQLite cannot relax a
 * NOT NULL / UNIQUE constraint in place, so `drizzle-kit push` rebuilds
 * `claude_account` — and its rebuild copies data with an
 * `INSERT INTO __new_claude_account (<new column list>) SELECT <new column
 * list> FROM claude_account`, which references the not-yet-existing `alias`
 * column and dies with `no such column: alias`. Its rebuild also re-issues
 * `CREATE INDEX` without dropping the originals first, so it then dies with
 * `index … already exists` — the same drizzle-kit idempotency bug already
 * documented on `project_profile_link` in `src/db/schema.def.ts`.
 *
 * Doing the additive work FIRST (plain `ALTER TABLE ADD COLUMN`, which SQLite
 * supports natively) and dropping the to-be-rebuilt indexes makes the
 * subsequent rebuild valid, and push then completes. PostgreSQL is unaffected —
 * it has a real generated migration (`drizzle/pg/0014_*.sql`).
 *
 * IDEMPOTENCE (this script runs on EVERY deploy — see `scripts/deploy.ts`)
 * ----------------------------------------------------------------------
 * Every action is gated on the migration NOT having happened yet, detected by
 * {@link isMigrationPending}: the pre-n4x4.6 marker columns
 * (`claude_account.credential_mode`, `claude_usage_limit_state.profile_id`,
 * `claude_profile_pool_member.profile_id`) are all dropped by `db:push`, so
 * once push has run this is a **complete no-op** — it does not delete rows and
 * does not drop indexes.
 *
 * That gate is load-bearing: the destructive steps below would otherwise wipe
 * pool membership and usage-limit state on every single deploy, and would drop
 * `claude_pool_member_pool_account_unique` until the next push recreated it.
 *
 * SAFETY: the rows that must be cleared are dumped to a timestamped JSON file
 * next to the database BEFORE anything is deleted, because the delete happens
 * in a separate process from the `db:push` that follows it — if push fails, the
 * dump is the only copy. See {@link dumpRows}.
 *
 * Safe to delete once every deployment has moved past this schema version.
 *
 * CLI entry: `scripts/presync-claude-accounts-sqlite.ts`
 * (`bun run db:presync-claude-accounts`, BEFORE `bun run db:push`).
 */
import type { Client } from "@libsql/client";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger } from "@/lib/logger";

const log = createLogger("PresyncClaudeAccounts");

/** Summary of one pre-sync run. */
export interface PresyncResult {
  /** False when the migration had already been applied (a full no-op). */
  pending: boolean;
  columnsAdded: number;
  columnsAlreadyPresent: number;
  indexesDropped: number;
  rowsCleared: number;
  /** Where the cleared rows were dumped, or null when there were none. */
  backupPath: string | null;
}

/**
 * The columns n4x4.6 adds, per table. All are added NULLABLE here even where
 * the final schema says NOT NULL — push's rebuild applies the real constraint,
 * and the tables it applies to are emptied first.
 */
const NEW_COLUMNS: Record<string, Array<{ name: string; ddl: string }>> = {
  claude_account: [
    { name: "alias", ddl: "text" },
    { name: "organization_id", ddl: "text" },
    { name: "auth_method", ddl: "text" },
    { name: "auth_healthy", ddl: "integer DEFAULT 0 NOT NULL" },
    { name: "last_verified_at", ddl: "integer" },
    { name: "oauth_token_encrypted", ddl: "text" },
    { name: "token_fingerprint", ddl: "text" },
  ],
  claude_usage_limit_state: [{ name: "account_id", ddl: "text" }],
  claude_profile_pool_member: [{ name: "account_id", ddl: "text" }],
  project_profile_link: [{ name: "account_id", ddl: "text" }],
  terminal_session: [{ name: "claude_account_id", ddl: "text" }],
};

/**
 * Pre-n4x4.6 marker columns. Each is DROPPED by `db:push`, so the presence of
 * any of them means the migration has not run yet. Absence of all of them means
 * it has — and this script must then do nothing destructive.
 */
const PENDING_MARKERS: Array<{ table: string; column: string }> = [
  { table: "claude_account", column: "credential_mode" },
  { table: "claude_usage_limit_state", column: "profile_id" },
  { table: "claude_profile_pool_member", column: "profile_id" },
];

/**
 * Tables whose IDENTITY column changed from `profile_id` to `account_id`, with
 * no mechanical translation. Cleared so the rebuild can apply the NOT NULL /
 * PRIMARY KEY constraint. This mirrors the PostgreSQL migration
 * (`drizzle/pg/0014_*.sql`), which documents the same deliberate loss:
 *   - `claude_usage_limit_state` holds ephemeral observations the detector /
 *     poller re-derive within one 5h window.
 *   - `claude_profile_pool_member` held profile-keyed rows; pool MEMBERSHIP
 *     must be re-added once, now as accounts. The pools themselves survive.
 */
const REKEYED_TABLES = [
  "claude_usage_limit_state",
  "claude_profile_pool_member",
];

/**
 * Tables `drizzle-kit push` must REBUILD (SQLite cannot relax NOT NULL/UNIQUE
 * or move a PRIMARY KEY in place), whose indexes must be dropped first.
 */
const REBUILT_TABLES = [
  "claude_account",
  "claude_usage_limit_state",
  "claude_profile_pool_member",
];

/** Column names of `table`, or an empty set when the table does not exist. */
async function columnsOf(client: Client, table: string): Promise<Set<string>> {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  return new Set(info.rows.map((r) => String(r.name)));
}

/**
 * Whether the n4x4.6 migration still needs to run. True when ANY pre-migration
 * marker column survives; false once `db:push` has dropped them all (or on a
 * fresh database where the tables do not exist yet — push creates them
 * outright and there is nothing to pre-sync).
 */
async function isMigrationPending(
  client: Client,
  tableNames: Set<string>
): Promise<boolean> {
  for (const marker of PENDING_MARKERS) {
    if (!tableNames.has(marker.table)) continue;
    const columns = await columnsOf(client, marker.table);
    if (columns.has(marker.column)) return true;
  }
  return false;
}

/**
 * Write every row of the to-be-cleared tables to a timestamped JSON file next
 * to the database and return its path (or null when there was nothing to dump).
 * This is the ONLY copy of that data if the `db:push` that follows fails.
 */
async function dumpRows(
  client: Client,
  dbPath: string,
  tableNames: Set<string>
): Promise<{ path: string; rowCount: number } | null> {
  const dump: Record<string, unknown[]> = {};
  let rowCount = 0;
  for (const table of REKEYED_TABLES) {
    if (!tableNames.has(table)) continue;
    const result = await client.execute(`SELECT * FROM ${table}`);
    dump[table] = result.rows.map((row) => ({ ...row }));
    rowCount += result.rows.length;
  }
  if (rowCount === 0) return null;

  const backupDir = join(dirname(dbPath), "migration-backups");
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(backupDir, `claude-accounts-presync-${stamp}.json`);
  await writeFile(
    path,
    JSON.stringify(
      {
        issue: "remote-dev-n4x4.6",
        takenAt: new Date().toISOString(),
        note: "Rows cleared by db:presync-claude-accounts because their identity column changed from profile_id to account_id. Pool membership must be re-added as accounts; usage-limit state is re-derived automatically.",
        tables: dump,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  return { path, rowCount };
}

export async function presyncClaudeAccounts(
  client: Client,
  dbPath: string
): Promise<PresyncResult> {
  const present = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );
  const tableNames = new Set(present.rows.map((r) => String(r.name)));

  if (!(await isMigrationPending(client, tableNames))) {
    log.info("Claude account pre-sync skipped: already migrated");
    return {
      pending: false,
      columnsAdded: 0,
      columnsAlreadyPresent: 0,
      indexesDropped: 0,
      rowsCleared: 0,
      backupPath: null,
    };
  }

  // 1. Additive columns, so push's table rebuild can SELECT them.
  let added = 0;
  let skipped = 0;
  for (const [table, columns] of Object.entries(NEW_COLUMNS)) {
    if (!tableNames.has(table)) continue; // fresh DB — push creates it outright

    const existing = await columnsOf(client, table);
    for (const column of columns) {
      if (existing.has(column.name)) {
        skipped++;
        continue;
      }
      await client.execute(
        `ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.ddl}`
      );
      added++;
    }
  }

  // 2. Back up, THEN clear the re-keyed tables. Order matters: the dump is the
  //    only copy if the `db:push` in the next process fails.
  const backup = await dumpRows(client, dbPath, tableNames);

  let cleared = 0;
  for (const table of REKEYED_TABLES) {
    if (!tableNames.has(table)) continue;
    const result = await client.execute(`DELETE FROM ${table}`);
    cleared += Number(result.rowsAffected ?? 0);
  }

  // 3. Drop the rebuilt tables' indexes so push can recreate them.
  //    `sqlite_autoindex_*` entries are implicit and cannot be dropped.
  let indexesDropped = 0;
  for (const table of REBUILT_TABLES) {
    if (!tableNames.has(table)) continue;
    const indexes = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%'",
      args: [table],
    });
    for (const row of indexes.rows) {
      await client.execute(`DROP INDEX IF EXISTS "${String(row.name)}"`);
      indexesDropped++;
    }
  }

  const result: PresyncResult = {
    pending: true,
    columnsAdded: added,
    columnsAlreadyPresent: skipped,
    indexesDropped,
    rowsCleared: cleared,
    backupPath: backup?.path ?? null,
  };
  log.info("Claude account pre-sync complete", { ...result });
  return result;
}

