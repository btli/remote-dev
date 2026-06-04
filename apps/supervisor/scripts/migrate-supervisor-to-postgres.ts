#!/usr/bin/env bun
/**
 * One-off: copy the Supervisor's SQLite registry -> Postgres (rdv_supervisor).
 *
 * The main app's `db:migrate-to-postgres` CLI targets the main 60-table schema;
 * the Supervisor has its own small schema (instance registry + auth), so this is
 * its dedicated copy. Same technique: Drizzle libsql read -> Drizzle node-postgres
 * write, so column modes handle all conversion (0/1->bool, epoch-ms->Date->
 * timestamptz). FK checks are deferred via `session_replication_role = replica`
 * (requires a SUPERUSER connection) so table order doesn't matter. Idempotent
 * (onConflictDoNothing). The target PG schema must already exist — apply
 * apps/supervisor/drizzle/pg first.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/rdv_supervisor \
 *   bun run apps/supervisor/scripts/migrate-supervisor-to-postgres.ts \
 *     --from file:/abs/path/supervisor.db [--verify]
 */
import { createClient } from "@libsql/client/node";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { is, sql } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { Pool } from "pg";
import * as sqliteSchema from "../src/db/schema.sqlite";
import * as pgSchema from "../src/db/schema.pg";

const argv = process.argv.slice(2);
const fromIdx = argv.indexOf("--from");
const fromUrl = fromIdx >= 0 ? argv[fromIdx + 1] : "";
const verify = argv.includes("--verify");
const toUrl = process.env.DATABASE_URL ?? "";
if (!fromUrl || !toUrl.startsWith("postgres")) {
  console.error(
    "Usage: DATABASE_URL=postgresql://... bun run .../migrate-supervisor-to-postgres.ts --from file:/path/supervisor.db [--verify]",
  );
  process.exit(2);
}

const sqlite = drizzleLibsql(createClient({ url: fromUrl }), {
  schema: sqliteSchema,
});
const pool = new Pool({ connectionString: toUrl });
const pg = drizzlePg(pool, { schema: pgSchema });

// Pair each exported SQLite table with its PG counterpart (same export name).
const tables: Array<{ name: string; sqlName: string; sT: SQLiteTable; pT: unknown }> =
  [];
for (const [name, val] of Object.entries(sqliteSchema)) {
  if (is(val, SQLiteTable)) {
    const pT = (pgSchema as Record<string, unknown>)[name];
    if (pT) tables.push({ name, sqlName: getTableConfig(val).name, sT: val, pT });
  }
}

const BATCH = 200;
let total = 0;
await pool.query("SET session_replication_role = replica");
try {
  for (const { sqlName, sT, pT } of tables) {
    const rows = (await sqlite.select().from(sT)) as Record<string, unknown>[];
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      if (chunk.length)
        await pg
          .insert(pT as never)
          .values(chunk as never)
          .onConflictDoNothing();
    }
    console.log(`  ${sqlName}: copied ${rows.length}`);
    total += rows.length;
  }
} finally {
  await pool.query("SET session_replication_role = origin");
}
console.log(`Copied ${total} rows across ${tables.length} tables.`);

if (verify) {
  let mismatch = false;
  for (const { sqlName, sT, pT } of tables) {
    const src = (await sqlite.select({ c: sql<number>`count(*)` }).from(sT))[0]
      ?.c;
    const dst = (
      (await pg
        .select({ c: sql<number>`count(*)` })
        .from(pT as never)) as { c: number }[]
    )[0]?.c;
    const ok = Number(src) === Number(dst);
    if (!ok) mismatch = true;
    console.log(`  verify ${sqlName}: sqlite=${src} pg=${dst} ${ok ? "OK" : "MISMATCH"}`);
  }
  if (mismatch) {
    console.error("VERIFY FAILED");
    await pool.end();
    process.exit(1);
  }
}
await pool.end();
console.log("Supervisor migration complete.");
