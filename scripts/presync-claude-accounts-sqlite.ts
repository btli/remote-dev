#!/usr/bin/env bun
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
 * column and dies with `no such column: alias`.
 *
 * Adding the new columns FIRST (plain `ALTER TABLE ADD COLUMN`, which SQLite
 * supports natively) makes the subsequent rebuild's SELECT valid, and push then
 * completes. PostgreSQL is unaffected — it has a real generated migration
 * (`drizzle/pg/0014_*.sql`).
 *
 * Idempotent: every column is added only when absent, so re-running is a no-op.
 * Safe to delete once every deployment has moved past this schema version.
 *
 * Run with: bun run db:presync-claude-accounts   (BEFORE `bun run db:push`)
 */
import { createClient } from "@libsql/client";
import { getDatabasePath } from "../src/lib/paths";

/**
 * The columns n4x4.6 adds, per table. All are added NULLABLE here even where
 * the final schema says NOT NULL — push's rebuild applies the real constraint,
 * and the tables it applies to are emptied below first.
 */
const NEW_COLUMNS: Record<string, Array<{ name: string; ddl: string }>> = {
  claude_account: [
    { name: "alias", ddl: "text" },
    { name: "organization_id", ddl: "text" },
    { name: "auth_method", ddl: "text" },
    { name: "auth_healthy", ddl: "integer DEFAULT 0 NOT NULL" },
    { name: "last_verified_at", ddl: "integer" },
    { name: "oauth_token_encrypted", ddl: "text" },
  ],
  claude_usage_limit_state: [{ name: "account_id", ddl: "text" }],
  claude_profile_pool_member: [{ name: "account_id", ddl: "text" }],
  project_profile_link: [{ name: "account_id", ddl: "text" }],
  terminal_session: [{ name: "claude_account_id", ddl: "text" }],
};

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
 * or move a PRIMARY KEY in place). Its rebuild re-issues `CREATE INDEX` for
 * every index without dropping the originals first, so the push dies with
 * `index … already exists` — the same drizzle-kit idempotency bug already
 * documented on `project_profile_link` in `src/db/schema.def.ts`. Dropping
 * these tables' indexes up front lets the rebuild recreate them cleanly.
 */
const REBUILT_TABLES = [
  "claude_account",
  "claude_usage_limit_state",
  "claude_profile_pool_member",
];

async function main(): Promise<void> {
  const client = createClient({ url: `file:${getDatabasePath()}` });

  const present = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );
  const tableNames = new Set(present.rows.map((r) => String(r.name)));

  let added = 0;
  let skipped = 0;
  for (const [table, columns] of Object.entries(NEW_COLUMNS)) {
    if (!tableNames.has(table)) continue; // fresh DB — push creates it outright

    const info = await client.execute(`PRAGMA table_info(${table})`);
    const existing = new Set(info.rows.map((r) => String(r.name)));

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

  // Drop the rebuilt tables' indexes so push can recreate them (see above).
  // `sqlite_autoindex_*` entries are implicit and cannot be dropped, so skip.
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

  let cleared = 0;
  for (const table of REKEYED_TABLES) {
    if (!tableNames.has(table)) continue;
    const result = await client.execute(`DELETE FROM ${table}`);
    cleared += Number(result.rowsAffected ?? 0);
  }

  console.log(
    `✅ claude account pre-sync: ${added} column(s) added, ` +
      `${skipped} already present, ${indexesDropped} index(es) dropped, ` +
      `${cleared} re-keyed row(s) cleared. ` +
      "Now run `bun run db:push`."
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ claude_account pre-sync failed:", error);
    process.exit(1);
  });
