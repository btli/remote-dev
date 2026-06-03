/**
 * Recursive CTE parity on real PostgreSQL (Unit 11 B/C).
 *
 * Seeds a project_group hierarchy and runs the EXACT ancestry + descendants
 * `WITH RECURSIVE` CTEs from DrizzleProjectGroupRepository through the
 * dialect-pg `execute(sql, args)` facade. This verifies end to end that:
 *   - the `?` -> `$N` placeholder rewrite in dialect-pg works on real PG,
 *   - recursive CTEs with `UNION` + depth guard return the correct rows, and
 *   - ancestry rows come back ordered by depth ASC.
 *
 * The CTE SQL is copied verbatim from
 * src/infrastructure/persistence/repositories/DrizzleProjectGroupRepository.ts
 * (listAncestry / listDescendantGroupIds).
 *
 * The dialect-pg builder reads `DATABASE_URL`; we point it at the isolated
 * test schema (via `?options=-c search_path=<schema>`) so `buildPgDialect()`'s
 * own pool runs against this test's tables.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb, type TestDb } from "./get-test-db";
import { buildPgDialect } from "@/db/dialect-pg";
import type { Dialect } from "@/db/dialect";
import { users } from "@/db/schema.pg";

// Verbatim from DrizzleProjectGroupRepository.listAncestry.
const ANCESTRY_SQL = `
  WITH RECURSIVE ancestry(id, parent_group_id, user_id, name, collapsed, sort_order, created_at, updated_at, depth) AS (
    SELECT id, parent_group_id, user_id, name, collapsed, sort_order, created_at, updated_at, 0
      FROM project_group WHERE id = ?
    UNION
    SELECT pg.id, pg.parent_group_id, pg.user_id, pg.name, pg.collapsed, pg.sort_order, pg.created_at, pg.updated_at, a.depth + 1
      FROM project_group pg JOIN ancestry a ON pg.id = a.parent_group_id
      WHERE a.depth < 128
  )
  SELECT * FROM ancestry ORDER BY depth ASC
`;

// Verbatim from DrizzleProjectGroupRepository.listDescendantGroupIds.
const DESCENDANTS_SQL = `
  WITH RECURSIVE descendants(id, depth) AS (
    SELECT id, 0 FROM project_group WHERE id = ?
    UNION
    SELECT pg.id, d.depth + 1
    FROM project_group pg
    JOIN descendants d ON pg.parent_group_id = d.id
    WHERE d.depth < 128
  )
  SELECT id FROM descendants
`;

describe("recursive CTEs on PostgreSQL via dialect-pg.execute", () => {
  let tdb: TestDb;
  let dialect: Dialect;
  let savedDbUrl: string | undefined;
  const userId = crypto.randomUUID();

  // A 4-level chain: root -> a -> b -> c, plus a sibling under root.
  const root = crypto.randomUUID();
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const c = crypto.randomUUID();
  const sibling = crypto.randomUUID();

  beforeAll(async () => {
    tdb = await getTestDb("cte");

    // Seed the user and a hierarchy directly on the isolated-schema client.
    await tdb.db.insert(users).values({ id: userId, name: "CTE User", email: `${userId}@example.com` });

    const now = new Date();
    const insertGroup = async (id: string, parent: string | null, name: string): Promise<void> => {
      await tdb.client.query(
        `INSERT INTO project_group (id, user_id, parent_group_id, name, collapsed, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, 0, $5, $5)`,
        [id, userId, parent, name, now]
      );
    };
    await insertGroup(root, null, "root");
    await insertGroup(a, root, "a");
    await insertGroup(b, a, "b");
    await insertGroup(c, b, "c");
    await insertGroup(sibling, root, "sibling");

    // Build a genuine dialect-pg facade pointed at the isolated schema.
    savedDbUrl = process.env.DATABASE_URL;
    const u = new URL(tdb.url);
    u.searchParams.set("options", `-c search_path=${tdb.schema}`);
    process.env.DATABASE_URL = u.toString();
    dialect = buildPgDialect();
    // Sanity: the facade can reach the test schema.
    await dialect.runProbe();
  });

  afterAll(async () => {
    if (savedDbUrl !== undefined) process.env.DATABASE_URL = savedDbUrl;
    else delete process.env.DATABASE_URL;
    await tdb?.cleanup();
  });

  it("ancestry CTE returns the upward chain ordered by depth ASC", async () => {
    // From the deepest node `c`, ancestry should be c -> b -> a -> root.
    const result = await dialect.execute(ANCESTRY_SQL, [c]);
    const ids = result.rows.map((r) => r.id as string);
    expect(ids).toEqual([c, b, a, root]);

    // depth must be strictly increasing from 0.
    const depths = result.rows.map((r) => Number(r.depth));
    expect(depths).toEqual([0, 1, 2, 3]);

    // The boolean column survives the raw-SQL path as a real boolean.
    expect(typeof result.rows[0].collapsed).toBe("boolean");
  });

  it("ancestry CTE for a mid-level node stops at root", async () => {
    const result = await dialect.execute(ANCESTRY_SQL, [a]);
    const ids = result.rows.map((r) => r.id as string);
    expect(ids).toEqual([a, root]);
  });

  it("descendants CTE returns the root plus all descendants", async () => {
    // From `root`: root + a + b + c + sibling (order not guaranteed by SQL).
    const result = await dialect.execute(DESCENDANTS_SQL, [root]);
    const ids = result.rows.map((r) => r.id as string);
    expect(new Set(ids)).toEqual(new Set([root, a, b, c, sibling]));
    expect(ids.length).toBe(5);
  });

  it("descendants CTE from a mid node excludes its ancestors and siblings", async () => {
    // From `a`: a + b + c (NOT root, NOT sibling).
    const result = await dialect.execute(DESCENDANTS_SQL, [a]);
    const ids = result.rows.map((r) => r.id as string);
    expect(new Set(ids)).toEqual(new Set([a, b, c]));
  });

  it("descendants CTE for a leaf returns only itself", async () => {
    const result = await dialect.execute(DESCENDANTS_SQL, [c]);
    const ids = result.rows.map((r) => r.id as string);
    expect(ids).toEqual([c]);
  });
});
