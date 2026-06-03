/**
 * Offline SQLite -> Postgres migration CLI, end to end on real PG (Unit 11 B/C).
 *
 * Flow:
 *   1. Build a temp SQLite DB by running `drizzle-kit push` against a temp file
 *      (DATABASE_URL=file:<tmp>), materializing the full sqlite schema.
 *   2. Seed FK-safe rows through Drizzle/libsql bound to schema.sqlite:
 *        user -> project_group (epoch-SECONDS `mode:"timestamp"` createdAt)
 *             -> project -> terminal_session (boolean `pinned` + JSON in the
 *                text `type_metadata` column + epoch-ms `mode:"timestamp_ms"`).
 *   3. Pre-create a fresh isolated PG schema with the pg DDL applied
 *      (via getTestDb), then run the CLI:
 *        bun run scripts/migrate-to-postgres/index.ts \
 *          --from <tmp> --to <pgUrl?options=search_path=schema> --verify
 *   4. Assert exit 0 and spot-check that the epoch-seconds createdAt, the
 *      boolean, and the JSON landed correctly in PG.
 *
 * The CLI reads each table via libsql/schema.sqlite and writes via
 * node-postgres/schema.pg; the `--to` URL's `options=-c search_path=<schema>`
 * pins all CLI writes (and its --verify counts) to the isolated schema.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient, type Client as LibsqlClient } from "@libsql/client/node";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import * as sqliteSchema from "@/db/schema.sqlite";
import { getTestDb, type TestDb } from "./get-test-db";
import { projectGroups, terminalSessions } from "@/db/schema.pg";

const REPO_ROOT = path.resolve(__dirname, "../..");

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

// vitest runs under Node, so the Bun global is unavailable here. We spawn the
// `bun run ...` subprocess via node:child_process (the child is still Bun).
function run(cmd: string[], env: Record<string, string>): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = cmd;
    const proc = spawn(bin, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

describe("migrate-to-postgres CLI end to end", () => {
  let tdb: TestDb;
  let tmpDir: string;
  let watermarkDir: string;
  let sqlitePath: string;
  let libsql: LibsqlClient;

  const userId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  // Use a stable, sub-second-truncated timestamp so the epoch-seconds round
  // trip is exact, then assert within 1s for safety.
  const groupCreatedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const jsonPayload = { layout: "grid", tabs: [10, 20], nested: { ok: true } };

  beforeAll(async () => {
    // Isolated PG target schema (pg DDL already applied).
    tdb = await getTestDb("migcli");

    // Temp SQLite DB + isolated watermark dir.
    tmpDir = mkdtempSync(path.join(tmpdir(), "rdv-migcli-"));
    watermarkDir = mkdtempSync(path.join(tmpdir(), "rdv-watermark-"));
    sqlitePath = path.join(tmpDir, "sqlite.db");

    // Materialize the sqlite schema with drizzle-kit push.
    const push = await run(["bun", "run", "drizzle-kit", "push", "--force"], {
      DATABASE_URL: `file:${sqlitePath}`,
    });
    if (push.code !== 0) {
      throw new Error(`drizzle-kit push failed (${push.code}):\n${push.stdout}\n${push.stderr}`);
    }

    // Seed FK-safe rows via libsql + schema.sqlite (column modes do storage<->JS).
    libsql = createClient({ url: `file:${sqlitePath}` });
    const sdb = drizzleLibsql(libsql, { schema: sqliteSchema });

    await sdb.insert(sqliteSchema.users).values({
      id: userId,
      name: "Mig User",
      email: `${userId}@example.com`,
    });
    await sdb.insert(sqliteSchema.projectGroups).values({
      id: groupId,
      userId,
      name: "Mig Group",
      collapsed: true,
      sortOrder: 7,
      createdAt: groupCreatedAt, // mode:"timestamp" -> epoch SECONDS in sqlite
      updatedAt: groupCreatedAt,
    });
    await sdb.insert(sqliteSchema.projects).values({
      id: projectId,
      userId,
      groupId,
      name: "Mig Project",
    });
    await sdb.insert(sqliteSchema.terminalSessions).values({
      id: sessionId,
      userId,
      name: "Mig Session",
      tmuxSessionName: `rdv-${sessionId}`,
      projectId,
      pinned: true, // mode:"boolean"
      typeMetadata: JSON.stringify(jsonPayload), // JSON in a text column
      createdAt: groupCreatedAt,
      updatedAt: groupCreatedAt,
      lastActivityAt: groupCreatedAt,
    });
  });

  afterAll(async () => {
    libsql?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (watermarkDir) rmSync(watermarkDir, { recursive: true, force: true });
    await tdb?.cleanup();
  });

  it("runs the CLI with --verify, exits 0, and lands the data in PG", async () => {
    // Target the isolated schema by appending search_path options to the URL.
    const target = new URL(tdb.url);
    target.searchParams.set("options", `-c search_path=${tdb.schema}`);

    const result = await run(
      [
        "bun",
        "run",
        "scripts/migrate-to-postgres/index.ts",
        "--from",
        sqlitePath,
        "--to",
        target.toString(),
        "--verify",
        "--watermark-dir",
        watermarkDir,
      ],
      {}
    );

    if (result.code !== 0) {
      // Surface CLI output for debugging if it ever fails.
      throw new Error(
        `CLI exited ${result.code}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`
      );
    }
    expect(result.code).toBe(0);

    // Spot-check via the isolated-schema Drizzle handle.
    const [group] = await tdb.db
      .select()
      .from(projectGroups)
      .where(eq(projectGroups.id, groupId));
    expect(group).toBeDefined();
    // Epoch-seconds createdAt survived the SQLite->PG migration within 1s.
    expect(group.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(group.createdAt.getTime() - groupCreatedAt.getTime())).toBeLessThanOrEqual(1000);
    expect(typeof group.collapsed).toBe("boolean");
    expect(group.collapsed).toBe(true);
    expect(group.sortOrder).toBe(7);

    const [session] = await tdb.db
      .select()
      .from(terminalSessions)
      .where(eq(terminalSessions.id, sessionId));
    expect(session).toBeDefined();
    // Boolean is a real boolean in PG.
    expect(typeof session.pinned).toBe("boolean");
    expect(session.pinned).toBe(true);
    // JSON payload round-trips through the text column.
    expect(session.typeMetadata).toBeTypeOf("string");
    expect(JSON.parse(session.typeMetadata as string)).toEqual(jsonPayload);
    // Epoch-ms createdAt within 1s.
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(session.createdAt.getTime() - groupCreatedAt.getTime())).toBeLessThanOrEqual(1000);
  });
});
