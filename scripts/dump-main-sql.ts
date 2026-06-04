#!/usr/bin/env bun
/**
 * Emit a remote-dev INSTANCE's SQLite data as Postgres INSERT SQL (stdout), to
 * apply via `kubectl exec rdv-pg-1 -- psql` (port-forward is unreliable over
 * this link). Type conversion is driven by the schema DEFINITION kinds (so the
 * epoch-SECONDS tables — kind "timestampS" — convert with *1000, distinct from
 * epoch-ms "timestampMs"). Only source∩schema columns are copied (tolerates an
 * instance whose sqlite predates a column). FK + self-ref checks deferred via
 * session_replication_role=replica (superuser). Idempotent: ON CONFLICT DO NOTHING.
 *
 * Usage: bun run scripts/dump-main-sql.ts --from file:/abs/sqlite.db > /tmp/x.sql
 */
import { createClient } from "@libsql/client/node";
import { schema } from "../src/db/schema.def";

const fromIdx = process.argv.indexOf("--from");
const from = fromIdx >= 0 ? process.argv[fromIdx + 1] : "";
if (!from) {
  console.error("need --from file:/path/sqlite.db");
  process.exit(2);
}
const client = createClient({ url: from });

function lit(raw: unknown, kind: string): string {
  if (raw === null || raw === undefined) return "NULL";
  switch (kind) {
    case "boolean":
      return Number(raw) ? "true" : "false";
    case "timestampMs": {
      const ms = Number(raw);
      return Number.isFinite(ms) ? `'${new Date(ms).toISOString()}'::timestamptz` : "NULL";
    }
    case "timestampS": {
      const s = Number(raw);
      return Number.isFinite(s) ? `'${new Date(s * 1000).toISOString()}'::timestamptz` : "NULL";
    }
    case "json":
      return `'${String(raw).replace(/'/g, "''")}'::jsonb`;
    case "integer":
      return String(raw);
    default:
      return `'${String(raw).replace(/'/g, "''")}'`;
  }
}

const out: string[] = ["BEGIN;", "SET session_replication_role = replica;"];
let total = 0;
for (const table of schema) {
  const kindByCol = new Map(table.columns.map((c) => [c.dbName, c.kind as string]));
  const info = await client.execute(`PRAGMA table_info("${table.sqlName}")`);
  const srcCols = (info.rows as Array<Record<string, unknown>>)
    .map((r) => String(r.name))
    .filter((c) => kindByCol.has(c));
  if (srcCols.length === 0) {
    out.push(`-- ${table.sqlName}: SKIPPED (absent in source)`);
    continue;
  }
  const res = await client.execute(`SELECT * FROM "${table.sqlName}"`);
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const vals = srcCols.map((c) => lit(row[c], kindByCol.get(c)!));
    out.push(
      `INSERT INTO "${table.sqlName}" (${srcCols.map((c) => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")}) ON CONFLICT DO NOTHING;`,
    );
    total++;
  }
  if (res.rows.length) out.push(`-- ${table.sqlName}: ${res.rows.length}`);
}
out.push("SET session_replication_role = origin;", "COMMIT;");
console.log(out.join("\n"));
console.error(`Emitted ${total} INSERTs across ${schema.length} tables.`);
