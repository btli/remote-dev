#!/usr/bin/env bun
/**
 * CLI entry: drop the four Claude-automation profile/pool FOREIGN KEYs that
 * epic remote-dev-3b3l's Phase 1 added to PRE-EXISTING SQLite tables, so the
 * deploy's `db:push` becomes idempotent again (P0 deploy unblock).
 *
 * WHY THIS EXISTS
 * ---------------
 * `db:push` is `drizzle-kit push`, run non-interactively by scripts/deploy.ts
 * for the SQLite backend. Phase 1 added table-level FOREIGN KEY columns to four
 * PRE-EXISTING tables:
 *   - project_profile_link.pool_id  → claude_profile_pool (ON DELETE set null)
 *   - agent_run.profile_id          → agent_profile       (ON DELETE set null)
 *   - agent_schedule.profile_id     → agent_profile       (ON DELETE set null)
 *   - trigger_config.profile_id     → agent_profile       (ON DELETE set null)
 *
 * SQLite cannot ALTER a FOREIGN KEY in place, so drizzle-kit's push planner
 * tries to round-trip those table-level FKs via a full table REBUILD on every
 * push. Its SQLite rebuild path then emits the same `CREATE INDEX` TWICE and
 * crashes with `SqliteError: index <name> already exists`, which exits the push
 * non-zero and HARD-ABORTS the deploy for everyone.
 *
 * The schema (src/db/schema.def.ts) has been changed so these four columns are
 * plain `text` (no DB-level FK; set-null semantics are now enforced in the app —
 * see agent-profile-service.deleteProfile and
 * DrizzleProfilePoolRepository.deletePool). A FRESH `db:push` is therefore clean
 * and idempotent. But EXISTING SQLite databases (incl. the live prod DB) already
 * carry the real FKs from an earlier partial push, so `db:push` would still try
 * (and fail) to rebuild them to match the FK-free schema. This script performs
 * that ONE drop correctly — a single-index table rebuild — so the subsequent
 * `db:push` sees no diff. Postgres drops the same constraints via the generated
 * drizzle/pg migration (migrate-on-boot), so this script is SQLite-only.
 *
 * IDEMPOTENT: each table is rebuilt only if it still carries the poison FK
 * (checked via PRAGMA foreign_key_list). Once dropped, re-runs are no-ops, so it
 * is safe to call on every deploy. Runs inside one transaction with
 * foreign_keys temporarily OFF; a post-rebuild `PRAGMA foreign_key_check`
 * asserts no orphaned rows before committing.
 *
 * Run manually with: bun run db:reconcile-fk-drop
 */
import Database from "libsql";
import { getDatabasePath } from "../src/lib/paths";
import { shouldRunSqlitePush } from "./deploy-lib";

/** A poison FK to strip: the table it lives on and the column it references. */
interface PoisonFk {
  table: string;
  /** The local column whose FOREIGN KEY clause must be removed. */
  column: string;
  /** The table that column references (to disambiguate the right FK row). */
  references: string;
}

/**
 * The four FKs remote-dev-3b3l added to pre-existing tables. These — and only
 * these — are dropped; every other (pre-existing or new-table) FK is preserved.
 */
const POISON_FKS: PoisonFk[] = [
  { table: "project_profile_link", column: "pool_id", references: "claude_profile_pool" },
  { table: "agent_run", column: "profile_id", references: "agent_profile" },
  { table: "agent_schedule", column: "profile_id", references: "agent_profile" },
  { table: "trigger_config", column: "profile_id", references: "agent_profile" },
];

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
}

/** Return true if `table` still has a FOREIGN KEY on `column` → `references`. */
function hasPoisonFk(db: Database.Database, fk: PoisonFk): boolean {
  const rows = db
    .prepare(`PRAGMA foreign_key_list(${quoteIdent(fk.table)})`)
    .all() as ForeignKeyRow[];
  return rows.some((r) => r.from === fk.column && r.table === fk.references);
}

/** Quote a SQLite identifier with backticks (identifiers here are trusted constants). */
function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

/**
 * Remove the single `FOREIGN KEY (<column>) REFERENCES <references> ...` clause
 * from a table's `CREATE TABLE` SQL, returning DDL for a `__rc_<table>` rebuild
 * that is byte-identical to the original MINUS that one FK (and minus any now-
 * dangling comma). Throws if the expected FK line cannot be located, so we never
 * silently produce a wrong table shape.
 */
function buildRebuildDdl(createSql: string, fk: PoisonFk, newTable: string): string {
  // Each FK is emitted on its own line by drizzle/SQLite:
  //   FOREIGN KEY (`pool_id`) REFERENCES `claude_profile_pool`(`id`) ON ...
  const lines = createSql.split("\n");
  const fkLineIdx = lines.findIndex(
    (l) =>
      /^\s*FOREIGN KEY\s*\(/i.test(l) &&
      l.includes(`(\`${fk.column}\`)`) &&
      l.includes(`\`${fk.references}\``)
  );
  if (fkLineIdx === -1) {
    throw new Error(
      `Could not find the FOREIGN KEY (${fk.column}) -> ${fk.references} clause in ${fk.table}'s CREATE SQL; aborting rather than guessing.`
    );
  }

  // Dropping a middle FK leaves the PREVIOUS definition line ending in a comma
  // that is now the last item before `)`. Dropping the LAST FK leaves the prior
  // line with a trailing comma. Normalize: remove the FK line, then strip any
  // trailing comma on the line that becomes the final definition before `)`.
  const kept = lines.filter((_, i) => i !== fkLineIdx);

  // Find the closing `)` line (last line that is just `)` or `);`).
  let closeIdx = -1;
  for (let i = kept.length - 1; i >= 0; i--) {
    if (/^\s*\)\s*;?\s*$/.test(kept[i])) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new Error(`Malformed CREATE SQL for ${fk.table}: no closing paren found.`);
  }
  // The last definition line is the non-empty line immediately before closeIdx.
  for (let i = closeIdx - 1; i >= 0; i--) {
    if (kept[i].trim() === "") continue;
    kept[i] = kept[i].replace(/,(\s*)$/, "$1");
    break;
  }

  let ddl = kept.join("\n");

  // Rename the table being created to the temp name. Handle both
  // `CREATE TABLE "x"`, `CREATE TABLE \`x\``, and the IF NOT EXISTS variant.
  ddl = ddl.replace(
    /^(\s*CREATE\s+TABLE\s+)(?:IF\s+NOT\s+EXISTS\s+)?(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|\w+)/i,
    `$1${quoteIdent(newTable)}`
  );
  return ddl;
}

/** The list of column names (in physical order) for a table. */
function columnNames(db: Database.Database, table: string): string[] {
  const rows = db
    .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** The `CREATE INDEX` SQL for every explicit index on a table (skips autoindexes). */
function indexDdls(db: Database.Database, table: string): string[] {
  const rows = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL`
    )
    .all(table) as Array<{ sql: string }>;
  return rows.map((r) => r.sql);
}

function main(): void {
  if (!shouldRunSqlitePush(process.env.DATABASE_URL)) {
    process.stdout.write(
      "[db-reconcile-fk-drop] DATABASE_URL is Postgres — skipping (PG drops these FKs via drizzle/pg migrate-on-boot).\n"
    );
    return;
  }

  const dbPath = getDatabasePath();
  const db = new Database(dbPath);
  try {
    const targets = POISON_FKS.filter((fk) => {
      // A table that doesn't exist yet (fresh DB) needs no reconcile — db:push
      // will create it FK-free.
      const exists = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
        .get(fk.table);
      return exists && hasPoisonFk(db, fk);
    });

    if (targets.length === 0) {
      process.stdout.write(
        "[db-reconcile-fk-drop] No poison FKs present — nothing to do (idempotent no-op).\n"
      );
      return;
    }

    process.stdout.write(
      `[db-reconcile-fk-drop] Dropping ${targets.length} legacy FK(s): ${targets
        .map((t) => `${t.table}.${t.column}`)
        .join(", ")}\n`
    );

    db.exec("PRAGMA foreign_keys=OFF;");
    db.exec("BEGIN;");
    try {
      for (const fk of targets) {
        const tableRow = db
          .prepare(
            `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`
          )
          .get(fk.table) as { sql: string } | undefined;
        if (!tableRow?.sql) {
          throw new Error(`Missing CREATE SQL for ${fk.table}.`);
        }

        const tmp = `__rc_${fk.table}`;
        const ddl = buildRebuildDdl(tableRow.sql, fk, tmp);
        const cols = columnNames(db, fk.table)
          .map((c) => quoteIdent(c))
          .join(", ");
        const idxs = indexDdls(db, fk.table);

        db.exec(ddl);
        db.exec(
          `INSERT INTO ${quoteIdent(tmp)} (${cols}) SELECT ${cols} FROM ${quoteIdent(fk.table)};`
        );
        db.exec(`DROP TABLE ${quoteIdent(fk.table)};`);
        db.exec(`ALTER TABLE ${quoteIdent(tmp)} RENAME TO ${quoteIdent(fk.table)};`);
        // Recreate each explicit index exactly ONCE (the bug we are avoiding is
        // drizzle-kit's push emitting these twice).
        for (const idx of idxs) db.exec(`${idx};`);
      }

      // Assert no orphaned FK rows were introduced by the rebuild before commit.
      const violations = db.prepare("PRAGMA foreign_key_check;").all();
      if (violations.length > 0) {
        throw new Error(
          `foreign_key_check reported ${violations.length} violation(s) after rebuild; rolling back.`
        );
      }
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    } finally {
      db.exec("PRAGMA foreign_keys=ON;");
    }

    process.stdout.write("[db-reconcile-fk-drop] Done — legacy FKs dropped.\n");
  } finally {
    db.close();
  }
}

main();
