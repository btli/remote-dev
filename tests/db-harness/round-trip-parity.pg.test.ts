/**
 * Round-trip parity on real PostgreSQL (Unit 11 B/C).
 *
 * Inserts and reads back rows via Drizzle bound to the concrete `schema.pg`
 * tables, asserting that the dialect's column modes survive a real PG round
 * trip:
 *   - users:             baseline text/uuid round-trip
 *   - project_group:     timestamp (the SQLite source is epoch-SECONDS) — the PG
 *                        column is `timestamp with time zone`; createdAt must
 *                        round-trip to within 1s.
 *   - terminal_session:  a real boolean (`pinned`), a timestamp (`createdAt`,
 *                        epoch-ms on the SQLite side) within 1s, and a JSON
 *                        payload (stored in the text `type_metadata` column)
 *                        that parses back to the original object.
 *   - node_preferences:  a jsonb column (`environment_vars`) that deep-equals
 *                        the inserted object.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb, type TestDb } from "./get-test-db";
import { users, projectGroups, projects, terminalSessions, nodePreferences } from "@/db/schema.pg";

const WITHIN_1S = 1000;

describe("round-trip parity on PostgreSQL", () => {
  let tdb: TestDb;
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    tdb = await getTestDb("roundtrip");
    await tdb.db.insert(users).values({ id: userId, name: "RT User", email: `${userId}@example.com` });
  });

  afterAll(async () => {
    await tdb?.cleanup();
  });

  it("users: text columns round-trip", async () => {
    const [row] = await tdb.db.select().from(users).where(eq(users.id, userId));
    expect(row).toBeDefined();
    expect(row.name).toBe("RT User");
    expect(row.email).toBe(`${userId}@example.com`);
  });

  it("project_group: timestamp (epoch-seconds source) round-trips within 1s", async () => {
    const groupId = crypto.randomUUID();
    const createdAt = new Date();
    await tdb.db.insert(projectGroups).values({
      id: groupId,
      userId,
      name: "Group RT",
      collapsed: false,
      sortOrder: 3,
      createdAt,
      updatedAt: createdAt,
    });

    const [row] = await tdb.db.select().from(projectGroups).where(eq(projectGroups.id, groupId));
    expect(row).toBeDefined();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(row.createdAt.getTime() - createdAt.getTime())).toBeLessThanOrEqual(WITHIN_1S);
    expect(typeof row.collapsed).toBe("boolean");
    expect(row.sortOrder).toBe(3);
  });

  it("terminal_session: real boolean + timestamp within 1s + JSON payload", async () => {
    // FK chain: terminal_session.project_id -> project.id -> user.id
    const projectId = crypto.randomUUID();
    await tdb.db.insert(projects).values({ id: projectId, userId, name: "Proj RT" });

    const sessionId = crypto.randomUUID();
    const createdAt = new Date();
    const payload = { layout: "split", panes: [1, 2, 3], meta: { active: true } };
    await tdb.db.insert(terminalSessions).values({
      id: sessionId,
      userId,
      name: "Session RT",
      tmuxSessionName: `rdv-${sessionId}`,
      projectId,
      pinned: true,
      typeMetadata: JSON.stringify(payload),
      createdAt,
      updatedAt: createdAt,
      lastActivityAt: createdAt,
    });

    const [row] = await tdb.db
      .select()
      .from(terminalSessions)
      .where(eq(terminalSessions.id, sessionId));
    expect(row).toBeDefined();

    // Boolean must be a real JS boolean (not 0/1 or "t").
    expect(typeof row.pinned).toBe("boolean");
    expect(row.pinned).toBe(true);

    // Timestamp round-trips to a Date within 1s.
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(row.createdAt.getTime() - createdAt.getTime())).toBeLessThanOrEqual(WITHIN_1S);

    // JSON payload (stored as text) parses back to the original object.
    expect(row.typeMetadata).toBeTypeOf("string");
    expect(JSON.parse(row.typeMetadata as string)).toEqual(payload);
  });

  it("node_preferences: jsonb deep-equals the inserted object", async () => {
    const prefId = crypto.randomUUID();
    const envVars = { FOO: "bar", NESTED: { a: 1, b: [true, false, null] }, count: 42 };
    const pinned = ["src/index.ts", "README.md"];
    await tdb.db.insert(nodePreferences).values({
      id: prefId,
      ownerId: crypto.randomUUID(),
      ownerType: "project",
      userId,
      environmentVars: envVars,
      pinnedFiles: pinned,
    });

    const [row] = await tdb.db
      .select()
      .from(nodePreferences)
      .where(eq(nodePreferences.id, prefId));
    expect(row).toBeDefined();
    // jsonb decodes straight back to a JS object — deep equality, not a string.
    expect(row.environmentVars).toEqual(envVars);
    expect(row.pinnedFiles).toEqual(pinned);
  });
});
