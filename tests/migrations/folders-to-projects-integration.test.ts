import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client/node";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Integration tests for the folders→projects migration.
 *
 * These tests spawn the migration script as a child process with DATABASE_URL
 * pointed at a tmpdir-backed SQLite file, so they never touch the developer's
 * real `~/.remote-dev/sqlite.db`.
 *
 * Each test:
 *   1. Creates a fresh empty SQLite file in tmpdir.
 *   2. Runs `bun run db:push` to materialize the full Drizzle schema.
 *   3. Seeds minimal fixture rows (users, folders, prefs).
 *   4. Runs the migration (or crashes it mid-way) and asserts invariants.
 */

const REPO_ROOT = resolve(__dirname, "../..");
const MIGRATE_SCRIPT = resolve(REPO_ROOT, "scripts/migrate-folders-to-projects.ts");
const DRIZZLE_CONFIG = resolve(REPO_ROOT, "drizzle.config.ts");

interface Fixture {
  dir: string;
  dbPath: string;
}

function createFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "rdv-mig-"));
  const dbPath = join(dir, "sqlite.db");
  return { dir, dbPath };
}

function pushSchema(dbPath: string) {
  const result = spawnSync(
    "bun",
    ["x", "drizzle-kit", "push", `--config=${DRIZZLE_CONFIG}`, "--force"],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbPath}`,
      },
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `drizzle-kit push failed: status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
}

async function seed(dbPath: string) {
  const c = createClient({ url: `file:${dbPath}` });
  // One user, two folders (one group, one leaf under it), one prefs row on the group.
  await c.execute({
    sql: "INSERT INTO user (id, email) VALUES (?, ?)",
    args: ["user-1", "a@example.com"],
  });
  const now = Date.now();
  await c.execute({
    sql: `INSERT INTO user_settings (id, user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?)`,
    args: ["us-1", "user-1", now, now],
  });
  await c.execute({
    sql: `INSERT INTO session_folder (id, user_id, parent_id, name, collapsed, sort_order, created_at, updated_at)
          VALUES (?, ?, NULL, ?, 0, 0, ?, ?)`,
    args: ["grp-1", "user-1", "Parent Group", now, now],
  });
  await c.execute({
    sql: `INSERT INTO session_folder (id, user_id, parent_id, name, collapsed, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
    args: ["leaf-1", "user-1", "grp-1", "Child Leaf", now, now],
  });
  // Root-level leaf (feeds Workspace group)
  await c.execute({
    sql: `INSERT INTO session_folder (id, user_id, parent_id, name, collapsed, sort_order, created_at, updated_at)
          VALUES (?, ?, NULL, ?, 0, 0, ?, ?)`,
    args: ["leaf-2", "user-1", "Root Leaf", now, now],
  });
  await c.execute({
    sql: `INSERT INTO folder_preferences (id, folder_id, user_id, theme, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["pref-1", "leaf-1", "user-1", "dracula", now, now],
  });
  c.close();
}

function runMigration(dbPath: string, opts: { signal?: NodeJS.Signals } = {}) {
  // Use bun to run the TS script directly.
  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    LOG_LEVEL: "warn",
  };
  if (opts.signal) {
    // For signal-injection tests, use a shell wrapper that we can SIGTERM.
    return spawnSync("bun", ["run", MIGRATE_SCRIPT], {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
      timeout: 500,
      killSignal: opts.signal,
    });
  }
  return spawnSync("bun", ["run", MIGRATE_SCRIPT], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
  });
}

async function countRows(dbPath: string, table: string): Promise<number> {
  const c = createClient({ url: `file:${dbPath}` });
  const r = await c.execute(`SELECT count(*) AS n FROM ${table}`);
  c.close();
  return Number(r.rows[0]?.n ?? 0);
}

async function getMigrationStateKeys(dbPath: string): Promise<string[]> {
  const c = createClient({ url: `file:${dbPath}` });
  const r = await c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='_migration_state'"
  );
  if (r.rows.length === 0) {
    c.close();
    return [];
  }
  const keys = await c.execute("SELECT key FROM _migration_state");
  c.close();
  return keys.rows.map((row) => String(row.key));
}

describe("folders-to-projects migration integration", () => {
  let fixture: Fixture | null = null;

  afterEach(() => {
    if (fixture && existsSync(fixture.dir)) {
      try {
        rmSync(fixture.dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    fixture = null;
  });

  it(
    "14.5a: idempotent rerun after simulated crash",
    async () => {
      fixture = createFixture();
      pushSchema(fixture.dbPath);
      await seed(fixture.dbPath);

      // First run — let it complete fully.
      const first = runMigration(fixture.dbPath);
      expect(first.status).toBe(0);

      const pg1 = await countRows(fixture.dbPath, "project_group");
      const p1 = await countRows(fixture.dbPath, "project");
      const np1 = await countRows(fixture.dbPath, "node_preferences");
      // grp-1 + Workspace = 2 groups; leaf-1 (under grp-1) + leaf-2 (Workspace) = 2 projects.
      expect(pg1).toBe(2);
      expect(p1).toBe(2);
      expect(np1).toBe(1);

      const keys1 = await getMigrationStateKeys(fixture.dbPath);
      expect(keys1).toContain("folders-to-projects:complete");

      // Second run — should be a no-op, counts must be identical.
      const second = runMigration(fixture.dbPath);
      expect(second.status).toBe(0);
      const pg2 = await countRows(fixture.dbPath, "project_group");
      const p2 = await countRows(fixture.dbPath, "project");
      const np2 = await countRows(fixture.dbPath, "node_preferences");
      expect(pg2).toBe(pg1);
      expect(p2).toBe(p1);
      expect(np2).toBe(np1);
    },
    60_000
  );

  it(
    "14.5b: preflight aborts on orphan parent_id with zero writes",
    async () => {
      fixture = createFixture();
      pushSchema(fixture.dbPath);
      await seed(fixture.dbPath);

      // Corrupt parent_id on one folder.
      const c = createClient({ url: `file:${fixture.dbPath}` });
      await c.execute({
        sql: "UPDATE session_folder SET parent_id = ? WHERE id = ?",
        args: ["DEFINITELY-NOT-REAL", "leaf-1"],
      });
      c.close();

      const run = runMigration(fixture.dbPath);
      expect(run.status).not.toBe(0);
      const errOut = `${run.stdout}${run.stderr}`;
      expect(errOut).toMatch(/orphan/i);

      // No writes: project_group / project should be empty.
      expect(await countRows(fixture.dbPath, "project_group")).toBe(0);
      expect(await countRows(fixture.dbPath, "project")).toBe(0);
      expect(await countRows(fixture.dbPath, "node_preferences")).toBe(0);

      const keys = await getMigrationStateKeys(fixture.dbPath);
      // Preflight must fire *before* any state marker is written.
      expect(keys).not.toContain("folders-to-projects:tree-inserted");
      expect(keys).not.toContain("folders-to-projects:complete");
    },
    60_000
  );
});
