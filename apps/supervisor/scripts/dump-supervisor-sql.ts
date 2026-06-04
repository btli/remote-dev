#!/usr/bin/env bun
/**
 * Emit the Supervisor's SQLite registry as Postgres INSERT SQL (stdout), to be
 * applied via `kubectl exec rdv-pg-1 -- psql` (no port-forward — unreliable over
 * this link).
 *
 * The live supervisor runs an OLDER image, so its sqlite may be MISSING columns
 * that the new schema added (e.g. db_config_snapshot). So we read the source's
 * ACTUAL columns raw (libsql), and convert each by the TARGET pg column type
 * (boolean / timestamptz / jsonb / text). Only the source∩target columns are
 * copied; new target-only columns default to NULL. FK checks deferred via
 * session_replication_role. Idempotent: ON CONFLICT DO NOTHING.
 *
 * NOTE: the supervisor schema uses only boolean + timestamp_ms (epoch MS) + text/
 * json — no epoch-SECONDS columns — so date conversion is a simple new Date(ms).
 *
 * Usage: bun run apps/supervisor/scripts/dump-supervisor-sql.ts \
 *          --from file:/abs/supervisor.db > /tmp/sup-data.sql
 */
import { createClient } from "@libsql/client/node";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as pgSchema from "../src/db/schema.pg";

const fromIdx = process.argv.indexOf("--from");
const from = fromIdx >= 0 ? process.argv[fromIdx + 1] : "";
if (!from) {
  console.error("need --from file:/path/supervisor.db");
  process.exit(2);
}
const client = createClient({ url: from });

function lit(raw: unknown, dataType: string): string {
  if (raw === null || raw === undefined) return "NULL";
  switch (dataType) {
    case "boolean":
      return Number(raw) ? "true" : "false";
    case "date": {
      // supervisor stores epoch milliseconds (timestamp_ms)
      const ms = Number(raw);
      return Number.isFinite(ms) ? `'${new Date(ms).toISOString()}'::timestamptz` : "NULL";
    }
    case "json":
      // raw is already a JSON string in sqlite
      return `'${String(raw).replace(/'/g, "''")}'::jsonb`;
    case "number":
    case "bigint":
      return String(raw);
    default:
      return `'${String(raw).replace(/'/g, "''")}'`;
  }
}

const out: string[] = ["BEGIN;", "SET session_replication_role = replica;"];
let total = 0;
for (const val of Object.values(pgSchema)) {
  if (!is(val, PgTable)) continue;
  const cfg = getTableConfig(val);
  const tName = cfg.name;
  const typeByCol = new Map(cfg.columns.map((c) => [c.name, c.dataType]));
  // source columns actually present
  const info = await client.execute(`PRAGMA table_info("${tName}")`);
  const srcCols = (info.rows as Array<Record<string, unknown>>)
    .map((r) => String(r.name))
    .filter((c) => typeByCol.has(c)); // intersection with target
  if (srcCols.length === 0) {
    out.push(`-- ${tName}: SKIPPED (table absent in source)`);
    continue;
  }
  const res = await client.execute(`SELECT * FROM "${tName}"`);
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const vals = srcCols.map((c) => lit(row[c], typeByCol.get(c)!));
    out.push(
      `INSERT INTO "${tName}" (${srcCols.map((c) => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")}) ON CONFLICT DO NOTHING;`,
    );
    total++;
  }
  out.push(`-- ${tName}: ${res.rows.length} rows`);
}
out.push("SET session_replication_role = origin;", "COMMIT;");
console.log(out.join("\n"));
console.error(`Emitted ${total} INSERTs.`);
