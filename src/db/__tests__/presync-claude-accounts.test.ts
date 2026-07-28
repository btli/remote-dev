// @vitest-environment node
/**
 * Tests for the SQLite pre-sync step [remote-dev-n4x4.6].
 *
 * These run against REAL temporary SQLite databases (libsql file: URLs), not a
 * fake, because the whole point of the script is its interaction with SQLite's
 * DDL limitations — a mock would prove nothing.
 *
 * The behaviour under test that matters most is the IDEMPOTENCE GATE: this
 * script is wired into `scripts/deploy.ts` and therefore runs on every deploy,
 * so a second run must not delete rows or drop indexes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presyncClaudeAccounts } from "../presync-claude-accounts";

let dir: string;
let dbPath: string;
let client: Client;

/** The pre-n4x4.6 shape of the three tables the migration re-keys. */
async function createLegacySchema(c: Client): Promise<void> {
  await c.execute(`CREATE TABLE claude_account (
    id text PRIMARY KEY NOT NULL,
    profile_id text NOT NULL UNIQUE,
    user_id text NOT NULL,
    account_kind text DEFAULT 'subscription' NOT NULL,
    credential_mode text,
    email_address text,
    organization_name text,
    rate_limit_tier text,
    api_key_prefix text,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`);
  await c.execute(
    "CREATE INDEX claude_account_profile_idx ON claude_account (profile_id)"
  );
  await c.execute(
    "CREATE INDEX claude_account_user_idx ON claude_account (user_id)"
  );

  await c.execute(`CREATE TABLE claude_usage_limit_state (
    profile_id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    limit_status text DEFAULT 'unknown' NOT NULL,
    updated_at integer NOT NULL
  )`);
  await c.execute(
    "CREATE INDEX claude_usage_limit_user_status_idx ON claude_usage_limit_state (user_id, limit_status)"
  );

  await c.execute(`CREATE TABLE claude_profile_pool_member (
    id text PRIMARY KEY NOT NULL,
    pool_id text NOT NULL,
    profile_id text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL
  )`);
  await c.execute(
    "CREATE UNIQUE INDEX claude_pool_member_pool_profile_unique ON claude_profile_pool_member (pool_id, profile_id)"
  );

  await c.execute(`CREATE TABLE project_profile_link (
    project_id text PRIMARY KEY NOT NULL,
    profile_id text NOT NULL,
    pool_id text,
    created_at integer NOT NULL
  )`);
  await c.execute(`CREATE TABLE terminal_session (
    id text PRIMARY KEY NOT NULL,
    profile_id text
  )`);
}

/** Seed one row into each re-keyed table so the clear + backup have work. */
async function seedLegacyRows(c: Client): Promise<void> {
  await c.execute(
    "INSERT INTO claude_account VALUES ('acct-1','prof-1','user-1','subscription','file','me@example.com','Org','max',NULL,0,0)"
  );
  await c.execute(
    "INSERT INTO claude_usage_limit_state VALUES ('prof-1','user-1','limited',0)"
  );
  await c.execute(
    "INSERT INTO claude_profile_pool_member VALUES ('m-1','pool-1','prof-1',0,0)"
  );
}

/** Simulate what `db:push` does after the pre-sync: finish the re-key. */
async function applyMigration(c: Client): Promise<void> {
  await c.execute("DROP TABLE claude_usage_limit_state");
  await c.execute(`CREATE TABLE claude_usage_limit_state (
    account_id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    limit_status text DEFAULT 'unknown' NOT NULL,
    updated_at integer NOT NULL
  )`);
  await c.execute(
    "CREATE INDEX claude_usage_limit_user_status_idx ON claude_usage_limit_state (user_id, limit_status)"
  );

  await c.execute("DROP TABLE claude_profile_pool_member");
  await c.execute(`CREATE TABLE claude_profile_pool_member (
    id text PRIMARY KEY NOT NULL,
    pool_id text NOT NULL,
    account_id text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL
  )`);
  await c.execute(
    "CREATE UNIQUE INDEX claude_pool_member_pool_account_unique ON claude_profile_pool_member (pool_id, account_id)"
  );

  // `credential_mode` dropped, `profile_id` relaxed to nullable/non-unique.
  await c.execute("ALTER TABLE claude_account DROP COLUMN credential_mode");
}

async function indexNames(c: Client, table: string): Promise<string[]> {
  const rows = await c.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%'",
    args: [table],
  });
  return rows.rows.map((r) => String(r.name)).sort();
}

async function countRows(c: Client, table: string): Promise<number> {
  const r = await c.execute(`SELECT count(*) AS n FROM ${table}`);
  return Number(r.rows[0].n);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rdv-presync-"));
  dbPath = join(dir, "sqlite.db");
  client = createClient({ url: `file:${dbPath}` });
});

afterEach(async () => {
  client.close();
  await rm(dir, { recursive: true, force: true });
});

describe("presyncClaudeAccounts — pending migration", () => {
  beforeEach(async () => {
    await createLegacySchema(client);
    await seedLegacyRows(client);
  });

  it("adds the new columns so push's table rebuild can SELECT them", async () => {
    const result = await presyncClaudeAccounts(client, dbPath);

    expect(result.pending).toBe(true);
    expect(result.columnsAdded).toBeGreaterThan(0);

    const info = await client.execute("PRAGMA table_info(claude_account)");
    const columns = info.rows.map((r) => String(r.name));
    expect(columns).toEqual(
      expect.arrayContaining([
        "alias",
        "organization_id",
        "auth_method",
        "auth_healthy",
        "last_verified_at",
        "oauth_token_encrypted",
      ])
    );
  });

  it("clears the re-keyed tables but preserves claude_account rows", async () => {
    const result = await presyncClaudeAccounts(client, dbPath);

    expect(result.rowsCleared).toBe(2);
    expect(await countRows(client, "claude_usage_limit_state")).toBe(0);
    expect(await countRows(client, "claude_profile_pool_member")).toBe(0);
    // Accounts are the data we must NOT lose.
    expect(await countRows(client, "claude_account")).toBe(1);
  });

  it("backs the cleared rows up to a timestamped file BEFORE deleting them", async () => {
    const result = await presyncClaudeAccounts(client, dbPath);

    expect(result.backupPath).not.toBeNull();
    const dumped = JSON.parse(await readFile(result.backupPath as string, "utf-8"));
    expect(dumped.issue).toBe("remote-dev-n4x4.6");
    expect(dumped.tables.claude_profile_pool_member).toHaveLength(1);
    expect(dumped.tables.claude_profile_pool_member[0].profile_id).toBe("prof-1");
    expect(dumped.tables.claude_usage_limit_state).toHaveLength(1);
  });

  it("drops the to-be-rebuilt tables' indexes so push can recreate them", async () => {
    expect(await indexNames(client, "claude_account")).not.toHaveLength(0);

    const result = await presyncClaudeAccounts(client, dbPath);

    expect(result.indexesDropped).toBeGreaterThan(0);
    expect(await indexNames(client, "claude_account")).toEqual([]);
    expect(await indexNames(client, "claude_usage_limit_state")).toEqual([]);
    expect(await indexNames(client, "claude_profile_pool_member")).toEqual([]);
  });

  it("writes no backup file when there is nothing to clear", async () => {
    await client.execute("DELETE FROM claude_usage_limit_state");
    await client.execute("DELETE FROM claude_profile_pool_member");

    const result = await presyncClaudeAccounts(client, dbPath);

    expect(result.backupPath).toBeNull();
    await expect(readdir(join(dir, "migration-backups"))).rejects.toThrow();
  });
});

describe("presyncClaudeAccounts — idempotence gate (runs on EVERY deploy)", () => {
  it("is a COMPLETE no-op once the migration has been applied", async () => {
    await createLegacySchema(client);
    await seedLegacyRows(client);
    await presyncClaudeAccounts(client, dbPath);
    await applyMigration(client);

    // Post-migration state a live deploy would have: real membership + limits.
    await client.execute(
      "INSERT INTO claude_profile_pool_member VALUES ('m-2','pool-1','acct-1',0,0)"
    );
    await client.execute(
      "INSERT INTO claude_usage_limit_state VALUES ('acct-1','user-1','limited',0)"
    );
    const indexesBefore = await indexNames(client, "claude_profile_pool_member");

    const second = await presyncClaudeAccounts(client, dbPath);

    expect(second).toEqual({
      pending: false,
      columnsAdded: 0,
      columnsAlreadyPresent: 0,
      indexesDropped: 0,
      rowsCleared: 0,
      backupPath: null,
    });
    // The regression this gate exists to prevent: a deploy wiping real data.
    expect(await countRows(client, "claude_profile_pool_member")).toBe(1);
    expect(await countRows(client, "claude_usage_limit_state")).toBe(1);
    // …and leaving the unique index dropped until the next push.
    expect(await indexNames(client, "claude_profile_pool_member")).toEqual(
      indexesBefore
    );
    expect(indexesBefore).toContain("claude_pool_member_pool_account_unique");
  });

  it("is a no-op on a fresh database (push creates the tables outright)", async () => {
    const result = await presyncClaudeAccounts(client, dbPath);
    expect(result.pending).toBe(false);
    expect(result.rowsCleared).toBe(0);
  });

  it("stays destructive-free across repeated post-migration runs", async () => {
    await createLegacySchema(client);
    await seedLegacyRows(client);
    await presyncClaudeAccounts(client, dbPath);
    await applyMigration(client);
    await client.execute(
      "INSERT INTO claude_profile_pool_member VALUES ('m-2','pool-1','acct-1',0,0)"
    );

    for (let i = 0; i < 3; i++) {
      const r = await presyncClaudeAccounts(client, dbPath);
      expect(r.pending).toBe(false);
    }
    expect(await countRows(client, "claude_profile_pool_member")).toBe(1);
  });
});
