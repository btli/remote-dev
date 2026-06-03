#!/usr/bin/env bun
/**
 * Offline SQLite -> Postgres data migration CLI (dual-backend feature, Unit 10).
 *
 * Reads each table with a Drizzle libsql instance bound to the CONCRETE SQLite
 * schema (src/db/schema.sqlite) and writes with a Drizzle node-postgres
 * instance bound to the CONCRETE Postgres schema (src/db/schema.pg). Drizzle's
 * column modes convert storage<->JS on both ends, so a row read from a SQLite
 * table is directly insertable into the matching Postgres table — including the
 * epoch-seconds (`mode:"timestamp"`) and epoch-ms (`mode:"timestamp_ms"`)
 * columns, booleans, and JSON, with no hand-rolled per-column math. See
 * copy-engine.ts for the full round-trip rationale.
 *
 * Tables are copied in FK-dependency tier order (schema-graph.ts). Within a
 * tier (no inter-table dependencies) copies run with bounded concurrency.
 *
 * USAGE:
 *   bun run db:migrate-to-postgres --to postgresql://... [options]
 *
 * FLAGS:
 *   --from <url>         sqlite file path | file: URL | libsql url |
 *                        "default" (RDV_DATA_DIR/sqlite.db). Default: "default".
 *   --to <url>           postgresql:// connection string. REQUIRED.
 *   --tables <csv>       limit to these SQL table names.
 *   --truncate           TRUNCATE ... CASCADE each target before copy.
 *   --resume             skip tables already marked complete (watermark).
 *   --verify             after copy, compare source/target counts; exit 1 on mismatch.
 *   --batch-size <n>     insert batch size (default 500).
 *   --include-logs       also copy the logs.db sidecar.
 *   --include-analytics  also copy the analytics.db sidecar.
 *   --dry-run            plan only; touch nothing.
 *   --concurrency <n>    parallel copies WITHIN a tier (default 4).
 *   --watermark-dir <d>  watermark directory (default .migrate-watermarks/).
 *   --log-level <l>      error|warn|info|debug (default info).
 */

import { mkdirSync, existsSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client/node";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import * as sqliteSchema from "../../src/db/schema.sqlite";
import { collectTables, topoSortTiers, type TableInfo } from "./schema-graph";
import { copyTable, type TableResult } from "./copy-engine";
import { createCliLogger, type LogLevel } from "./logger";

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

interface Flags {
  from: string;
  to: string | null;
  tables: string[] | null;
  truncate: boolean;
  resume: boolean;
  verify: boolean;
  batchSize: number;
  includeLogs: boolean;
  includeAnalytics: boolean;
  dryRun: boolean;
  concurrency: number;
  watermarkDir: string;
  logLevel: LogLevel;
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = {
    from: "default",
    to: null,
    tables: null,
    truncate: false,
    resume: false,
    verify: false,
    batchSize: 500,
    includeLogs: false,
    includeAnalytics: false,
    dryRun: false,
    concurrency: 4,
    watermarkDir: ".migrate-watermarks",
    logLevel: "info",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--from":
        f.from = next();
        break;
      case "--to":
        f.to = next();
        break;
      case "--tables":
        f.tables = next()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--truncate":
        f.truncate = true;
        break;
      case "--resume":
        f.resume = true;
        break;
      case "--verify":
        f.verify = true;
        break;
      case "--batch-size":
        f.batchSize = Number(next());
        break;
      case "--include-logs":
        f.includeLogs = true;
        break;
      case "--include-analytics":
        f.includeAnalytics = true;
        break;
      case "--dry-run":
        f.dryRun = true;
        break;
      case "--concurrency":
        f.concurrency = Number(next());
        break;
      case "--watermark-dir":
        f.watermarkDir = next();
        break;
      case "--log-level":
        f.logLevel = next() as LogLevel;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown flag: ${a}`);
    }
  }

  if (!Number.isFinite(f.batchSize) || f.batchSize < 1)
    throw new Error("--batch-size must be a positive integer");
  if (!Number.isFinite(f.concurrency) || f.concurrency < 1)
    throw new Error("--concurrency must be a positive integer");

  return f;
}

function printHelp(): void {
  console.log(
    `Usage: bun run db:migrate-to-postgres --to postgresql://... [options]\n\n` +
      `  --from <url>         sqlite path | file: URL | libsql url | "default"\n` +
      `  --to <url>           postgresql:// connection string (required)\n` +
      `  --tables <csv>       limit to these SQL table names\n` +
      `  --truncate           TRUNCATE ... CASCADE each target before copy\n` +
      `  --resume             skip tables already complete (watermark)\n` +
      `  --verify             compare source/target counts; exit 1 on mismatch\n` +
      `  --batch-size <n>     insert batch size (default 500)\n` +
      `  --include-logs       also copy logs.db sidecar\n` +
      `  --include-analytics  also copy analytics.db sidecar\n` +
      `  --dry-run            plan only; touch nothing\n` +
      `  --concurrency <n>    parallel copies within a tier (default 4)\n` +
      `  --watermark-dir <d>  watermark dir (default .migrate-watermarks)\n` +
      `  --log-level <l>      error|warn|info|debug (default info)`
  );
}

// ---------------------------------------------------------------------------
// Source URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the `--from` value into a libsql client URL.
 *   "default"          -> file:<RDV_DATA_DIR>/sqlite.db (via src/lib/paths)
 *   "file:..."         -> as-is
 *   "libsql://..."     -> as-is
 *   "http(s)://..."    -> as-is (remote libsql)
 *   bare path          -> "file:<path>"
 *
 * `getDatabaseUrl()` from src/lib/paths is the single source of truth for the
 * default location; we call it WITHOUT a Postgres DATABASE_URL so it returns
 * the sqlite file URL.
 */
async function resolveFromUrl(from: string): Promise<string> {
  if (from === "default") {
    const { getDatabaseUrl } = await import("../../src/lib/paths");
    const saved = process.env.DATABASE_URL;
    // Ensure paths resolves to the sqlite default, not a pg URL.
    delete process.env.DATABASE_URL;
    try {
      return getDatabaseUrl();
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  }
  if (
    from.startsWith("file:") ||
    from.startsWith("libsql://") ||
    from.startsWith("http://") ||
    from.startsWith("https://")
  ) {
    return from;
  }
  // bare filesystem path
  return `file:${from}`;
}

// ---------------------------------------------------------------------------
// Watermarks (for --resume)
// ---------------------------------------------------------------------------

function watermarkPath(dir: string, sqlName: string): string {
  return join(dir, `${sqlName}.done`);
}

function isComplete(dir: string, sqlName: string): boolean {
  return existsSync(watermarkPath(dir, sqlName));
}

function markComplete(dir: string, sqlName: string, rows: number): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    watermarkPath(dir, sqlName),
    JSON.stringify({ sqlName, rows, at: new Date().toISOString() })
  );
}

// ---------------------------------------------------------------------------
// Bounded-concurrency map
// ---------------------------------------------------------------------------

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const log = createCliLogger(flags.logLevel);

  if (!flags.to) {
    log.error("ERROR: --to <postgresql://...> is required.\n");
    printHelp();
    process.exit(2);
  }
  if (
    !flags.to.startsWith("postgresql://") &&
    !flags.to.startsWith("postgres://")
  ) {
    log.error(`ERROR: --to must be a postgresql:// URL (got: ${flags.to})`);
    process.exit(2);
  }

  const fromUrl = await resolveFromUrl(flags.from);
  log.info("SQLite → Postgres migration");
  log.info(`  from: ${fromUrl}`);
  log.info(`  to:   ${flags.to.replace(/:[^:@/]+@/, ":****@")}`);
  if (flags.dryRun) log.info("  mode: DRY RUN (no writes)");
  if (flags.truncate) log.info("  mode: TRUNCATE CASCADE before copy");
  if (flags.resume) log.info("  mode: RESUME (skip completed watermarks)");

  // Build the two Drizzle instances directly from the concrete schemas.
  const sqliteClient = createClient({ url: fromUrl });
  const sqliteDb = drizzleLibsql(sqliteClient, { schema: sqliteSchema });

  const { Pool } = await import("pg");
  const { drizzle: drizzlePg } = await import("drizzle-orm/node-postgres");
  const pgPool = new Pool({ connectionString: flags.to });
  const pgDb = drizzlePg(pgPool, { schema: await import("../../src/db/schema.pg") });

  let exitCode = 0;

  try {
    // Build the dependency graph and topo tiers.
    const tables = collectTables();
    let selected = tables;
    if (flags.tables) {
      const wanted = new Set(flags.tables);
      const unknown = flags.tables.filter((t) => !tables.has(t));
      if (unknown.length > 0)
        throw new Error(`Unknown table(s): ${unknown.join(", ")}`);
      selected = new Map([...tables].filter(([name]) => wanted.has(name)));
    }
    const subset = flags.tables ? new Set(flags.tables) : undefined;
    const tiers = topoSortTiers(tables, subset);

    log.info("");
    log.info(
      `Plan: ${selected.size} table(s) across ${tiers.length} dependency tier(s).`
    );
    const selfRef = [...selected.values()].filter((t) => t.selfReferential);
    if (selfRef.length > 0)
      log.info(
        `  self-referential (row-ordered parent→child): ${selfRef
          .map((t) => t.sqlName)
          .join(", ")}`
      );

    const allResults: TableResult[] = [];

    for (let t = 0; t < tiers.length; t++) {
      const tierTables = tiers[t]
        .map((name) => selected.get(name))
        .filter((info): info is TableInfo => info !== undefined);
      if (tierTables.length === 0) continue;

      log.debug(`Tier ${t}: ${tierTables.map((x) => x.sqlName).join(", ")}`);

      // Self-referential tables must copy serially relative to themselves; the
      // wave ordering is handled inside copyTable. Concurrency across distinct
      // tables in the tier is still safe (no inter-table FK within a tier).
      const tierResults = await mapWithConcurrency(
        tierTables,
        flags.concurrency,
        async (info) => {
          if (flags.resume && isComplete(flags.watermarkDir, info.sqlName)) {
            log.info(`  ${info.sqlName}: skipped (watermark)`);
            return {
              sqlName: info.sqlName,
              sourceRows: -1,
              inserted: 0,
              skipped: true,
            } satisfies TableResult;
          }
          const r = await copyTable(
            sqliteDb,
            pgDb,
            info,
            {
              batchSize: flags.batchSize,
              truncate: flags.truncate,
              dryRun: flags.dryRun,
            },
            log
          );
          if (!flags.dryRun)
            markComplete(flags.watermarkDir, info.sqlName, r.sourceRows);
          return r;
        }
      );
      allResults.push(...tierResults);
    }

    // Summary.
    const copied = allResults.filter((r) => !r.skipped);
    const totalRows = copied.reduce((n, r) => n + Math.max(0, r.sourceRows), 0);
    log.info("");
    log.info(
      `Main DB: ${copied.length} table(s) copied, ${
        allResults.length - copied.length
      } skipped, ${totalRows} total row(s).`
    );

    // Sidecars.
    if ((flags.includeLogs || flags.includeAnalytics) && !flags.dryRun) {
      log.info("");
      log.info("Sidecars:");
      // initSidecarSchemas reads getSidecarPool() which uses DATABASE_URL.
      const savedUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = flags.to;
      try {
        const { initSidecarSchemas } = await import(
          "../../src/infrastructure/persistence/pg/sidecar-schema"
        );
        await initSidecarSchemas();

        const { getDataDir } = await import("../../src/lib/paths");
        const sidecarPool = new Pool({ connectionString: flags.to, max: 5 });
        const sidecarResults: import("./sidecars").SidecarResult[] = [];
        try {
          if (flags.includeLogs) {
            const { copyLogs } = await import("./sidecars");
            const logsPath = join(getDataDir(), "logs", "logs.db");
            if (existsSync(logsPath)) {
              sidecarResults.push(
                await copyLogs(sidecarPool, logsPath, flags.batchSize, log)
              );
            } else {
              log.warn(`  logs.db not found at ${logsPath}; skipping`);
            }
          }
          if (flags.includeAnalytics) {
            const { copyAnalytics } = await import("./sidecars");
            const analyticsPath = join(
              getDataDir(),
              "analytics",
              "analytics.db"
            );
            if (existsSync(analyticsPath)) {
              sidecarResults.push(
                ...(await copyAnalytics(
                  sidecarPool,
                  analyticsPath,
                  flags.batchSize,
                  log
                ))
              );
            } else {
              log.warn(`  analytics.db not found at ${analyticsPath}; skipping`);
            }
          }

          if (flags.verify && sidecarResults.length > 0) {
            const { verifySidecars } = await import("./sidecars");
            log.info("");
            log.info("Sidecar verification:");
            const ok = await verifySidecars(sidecarPool, sidecarResults, log);
            if (!ok) exitCode = 1;
          }
        } finally {
          await sidecarPool.end();
        }
      } finally {
        if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
        else delete process.env.DATABASE_URL;
      }
    } else if (
      (flags.includeLogs || flags.includeAnalytics) &&
      flags.dryRun
    ) {
      log.info("  [dry-run] sidecars: would copy logs/analytics");
    }

    // Verify main DB.
    if (flags.verify && !flags.dryRun) {
      const { verifyCounts } = await import("./verify");
      const verifyTables = [...selected.values()];
      const { ok } = await verifyCounts(sqliteDb, pgDb, verifyTables, log);
      if (!ok) exitCode = 1;
    }

    if (flags.dryRun) log.info("\nDry run complete — nothing was written.");
    else log.info(`\nMigration ${exitCode === 0 ? "complete" : "FAILED"}.`);
  } finally {
    sqliteClient.close();
    await pgPool.end();
  }

  process.exit(exitCode);
}

// Exported for potential reuse/testing; not used internally.
export { parseFlags, resolveFromUrl, mapWithConcurrency };

// Allow `--watermark-dir` cleanup helper to be reachable if ever needed.
export function clearWatermarks(dir: string): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".done")) rmSync(join(dir, f));
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
