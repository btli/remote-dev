import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";
import { resolveMigrationsFolder } from "@/db/migrate";

/**
 * Migrate-on-boot: applying the committed Drizzle migrations to a FRESH DB must
 * create every table — the existing supervisor tables AND the new NextAuth
 * identity tables. This is the regression guard that a fresh PVC boots with a
 * complete schema (closes bd remote-dev-bqgo).
 *
 * We migrate a throwaway temp-file libsql DB directly (not the app's singleton
 * `db`, which targets the configured path) using the same migrations folder the
 * runtime resolver finds.
 */

let tmp: string | null = null;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  vi.resetModules();
});

/**
 * The DDL `drizzle-kit push` produces for the 5 ORIGINAL supervisor tables —
 * bare `CREATE TABLE` (no `IF NOT EXISTS`), and crucially NO `__drizzle_migrations`
 * history row. This reproduces the live homelab DB state (pre-OIDC, push-created).
 */
const LEGACY_PUSH_DDL = [
  `CREATE TABLE \`supervisor_user\` (
     \`id\` text PRIMARY KEY NOT NULL,
     \`email\` text NOT NULL,
     \`role\` text DEFAULT 'viewer' NOT NULL,
     \`created_at\` integer NOT NULL,
     \`updated_at\` integer NOT NULL
   )`,
  `CREATE UNIQUE INDEX \`supervisor_user_email_unique\` ON \`supervisor_user\` (\`email\`)`,
  `CREATE TABLE \`instance\` (
     \`id\` text PRIMARY KEY NOT NULL,
     \`slug\` text NOT NULL,
     \`display_name\` text NOT NULL,
     \`owner_id\` text NOT NULL,
     \`status\` text DEFAULT 'requested' NOT NULL,
     \`namespace\` text NOT NULL,
     \`created_at\` integer NOT NULL,
     \`updated_at\` integer NOT NULL
   )`,
  `CREATE TABLE \`registered_storage_target\` (
     \`id\` text PRIMARY KEY NOT NULL,
     \`name\` text NOT NULL,
     \`kind\` text NOT NULL,
     \`config\` text NOT NULL,
     \`is_default\` integer DEFAULT false NOT NULL,
     \`created_at\` integer NOT NULL
   )`,
  `CREATE TABLE \`instance_audit_log\` (
     \`id\` text PRIMARY KEY NOT NULL,
     \`instance_id\` text NOT NULL,
     \`action\` text NOT NULL,
     \`created_at\` integer NOT NULL
   )`,
  `CREATE TABLE \`instance_seed\` (
     \`id\` text PRIMARY KEY NOT NULL,
     \`instance_id\` text NOT NULL,
     \`job_dispatched\` integer DEFAULT false NOT NULL
   )`,
];

describe("migrate-on-boot", () => {
  it("creates the supervisor + NextAuth tables on a fresh database", async () => {
    tmp = mkdtempSync(join(tmpdir(), "sup-migrate-"));
    const client = createClient({ url: `file:${join(tmp, "fresh.db")}` });
    const db = drizzle(client);

    await migrate(db, { migrationsFolder: resolveMigrationsFolder() });

    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    const tables = new Set(rows.map((r) => r.name));

    // Supervisor (existing) tables.
    for (const t of [
      "supervisor_user",
      "instance",
      "registered_storage_target",
      "instance_audit_log",
      "instance_seed",
    ]) {
      expect(tables.has(t), `missing supervisor table: ${t}`).toBe(true);
    }

    // NextAuth identity tables (the new ones).
    for (const t of ["user", "account", "session", "verificationToken"]) {
      expect(tables.has(t), `missing NextAuth table: ${t}`).toBe(true);
    }

    client.close();
  });

  it("is idempotent — re-running migrate on an already-migrated DB is a no-op", async () => {
    tmp = mkdtempSync(join(tmpdir(), "sup-migrate-idem-"));
    const client = createClient({ url: `file:${join(tmp, "fresh.db")}` });
    const db = drizzle(client);
    const folder = resolveMigrationsFolder();

    await migrate(db, { migrationsFolder: folder });
    // Second run must not throw (tracked in __drizzle_migrations).
    await expect(
      migrate(db, { migrationsFolder: folder }),
    ).resolves.toBeUndefined();

    client.close();
  });

  // ── CRITICAL regression: a `db:push`-created LEGACY DB (5 original tables, NO
  // __drizzle_migrations history) must NOT crash the migrator. With bare
  // `CREATE TABLE` the batch would abort on "table supervisor_user already
  // exists" → CrashLoopBackOff. The idempotent `IF NOT EXISTS` SQL skips the 5
  // existing tables and creates the 4 new NextAuth tables.
  it("does NOT throw on a legacy push-created DB and adds the NextAuth tables (direct migrate)", async () => {
    tmp = mkdtempSync(join(tmpdir(), "sup-migrate-legacy-"));
    const client = createClient({ url: `file:${join(tmp, "legacy.db")}` });
    const db = drizzle(client);

    // Reproduce the legacy state: original tables present, no migration history.
    for (const ddl of LEGACY_PUSH_DDL) {
      await client.execute(ddl);
    }

    await expect(
      migrate(db, { migrationsFolder: resolveMigrationsFolder() }),
    ).resolves.toBeUndefined();

    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    const tables = new Set(rows.map((r) => r.name));
    // The 5 legacy tables survive…
    for (const t of [
      "supervisor_user",
      "instance",
      "registered_storage_target",
      "instance_audit_log",
      "instance_seed",
    ]) {
      expect(tables.has(t), `legacy table missing: ${t}`).toBe(true);
    }
    // …and the 4 NextAuth tables are now created.
    for (const t of ["user", "account", "session", "verificationToken"]) {
      expect(tables.has(t), `NextAuth table not added: ${t}`).toBe(true);
    }

    client.close();
  });

  // Same scenario through the REAL boot entry point `runMigrations()` (which uses
  // the app's `db` singleton resolved from DATABASE_URL).
  it("runMigrations() does NOT throw on a legacy push-created DB and adds the NextAuth tables", async () => {
    tmp = mkdtempSync(join(tmpdir(), "sup-migrate-legacy-run-"));
    const dbPath = join(tmp, "legacy.db");

    // Pre-create the legacy tables in the same file the singleton `db` will open.
    const seedClient = createClient({ url: `file:${dbPath}` });
    for (const ddl of LEGACY_PUSH_DDL) {
      await seedClient.execute(ddl);
    }
    seedClient.close();

    // Point the app DB at this file, then load a FRESH module graph so `@/db`
    // (and `@/db/migrate`) bind to DATABASE_URL=legacy.db.
    process.env.DATABASE_URL = `file:${dbPath}`;
    vi.resetModules();
    const { runMigrations } = await import("@/db/migrate");

    await expect(runMigrations()).resolves.toBeUndefined();

    const verifyClient = createClient({ url: `file:${dbPath}` });
    const result = await verifyClient.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const tables = new Set(result.rows.map((r) => String(r.name)));
    for (const t of ["user", "account", "session", "verificationToken"]) {
      expect(tables.has(t), `NextAuth table not added via runMigrations: ${t}`).toBe(
        true,
      );
    }
    // Legacy data table still present (no clobber).
    expect(tables.has("supervisor_user")).toBe(true);
    verifyClient.close();
  });
});
