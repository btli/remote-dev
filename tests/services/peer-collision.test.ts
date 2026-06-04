// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@/db/schema";

// [x386.14] Collision detection over cached work-contexts. Two active sessions
// sharing a branch, worktree path, or claimed bd issue are the most common
// cause of stepped-on work.

let client: Client;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let tmpDir: string;

vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
}));

const DDL = [
  `CREATE TABLE terminal_session (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    tmux_session_name TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    last_activity_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  `CREATE TABLE agent_work_context (
    session_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    branch TEXT,
    worktree_path TEXT,
    activity_status TEXT,
    claimed_issue_id TEXT,
    claimed_issue_title TEXT,
    join_confidence TEXT,
    updated_at INTEGER NOT NULL
  );`,
  `CREATE INDEX agent_work_context_project_idx ON agent_work_context (project_id);`,
];

async function resetDb(): Promise<void> {
  tmpDir = mkdtempSync(join(tmpdir(), "rdv-collision-test-"));
  client = createClient({ url: `file:${join(tmpDir, "test.db")}` });
  testDb = drizzle(client, { schema });
  for (const stmt of DDL) await client.execute(stmt);
}

function cleanupDb(): void {
  client?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

import { detectCollisions } from "@/services/work-context-service";

async function insertSession(id: string, name: string, status = "active"): Promise<void> {
  await client.execute({
    sql: `INSERT INTO terminal_session (id, user_id, name, tmux_session_name, project_id, status, last_activity_at, created_at, updated_at)
          VALUES (?, 'u1', ?, ?, 'proj-1', ?, 0, 0, 0)`,
    args: [id, name, `tmux-${id}`, status],
  });
}

async function insertContext(opts: {
  sessionId: string;
  branch?: string | null;
  worktreePath?: string | null;
  issueId?: string | null;
}): Promise<void> {
  await client.execute({
    sql: `INSERT INTO agent_work_context (session_id, project_id, branch, worktree_path, claimed_issue_id, join_confidence, updated_at)
          VALUES (?, 'proj-1', ?, ?, ?, 'branch', 0)`,
    args: [opts.sessionId, opts.branch ?? null, opts.worktreePath ?? null, opts.issueId ?? null],
  });
}

describe("detectCollisions (x386.14)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    cleanupDb();
  });

  it("flags a branch collision in BOTH directions for two sessions on the same branch", async () => {
    await insertSession("s1", "alice");
    await insertSession("s2", "bob");
    await insertContext({ sessionId: "s1", branch: "feat/x386.11", worktreePath: "/wt/s1" });
    await insertContext({ sessionId: "s2", branch: "feat/x386.11", worktreePath: "/wt/s2" });

    const forS1 = await detectCollisions("s1");
    expect(forS1).toHaveLength(1);
    expect(forS1[0]).toMatchObject({ peerSessionId: "s2", peerName: "bob", reason: "branch", value: "feat/x386.11" });

    const forS2 = await detectCollisions("s2");
    expect(forS2).toHaveLength(1);
    expect(forS2[0]).toMatchObject({ peerSessionId: "s1", peerName: "alice", reason: "branch" });
  });

  it("flags a worktree collision when branches differ but paths match", async () => {
    await insertSession("s1", "alice");
    await insertSession("s2", "bob");
    await insertContext({ sessionId: "s1", branch: "feat/a", worktreePath: "/shared/wt" });
    await insertContext({ sessionId: "s2", branch: "feat/b", worktreePath: "/shared/wt" });

    const out = await detectCollisions("s1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reason: "worktree", value: "/shared/wt", peerName: "bob" });
  });

  it("flags an issue collision when only the claimed bd issue matches", async () => {
    await insertSession("s1", "alice");
    await insertSession("s2", "bob");
    await insertContext({ sessionId: "s1", branch: "feat/a", worktreePath: "/wt/s1", issueId: "x386.6" });
    await insertContext({ sessionId: "s2", branch: "feat/b", worktreePath: "/wt/s2", issueId: "x386.6" });

    const out = await detectCollisions("s1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reason: "issue", value: "x386.6", peerName: "bob" });
  });

  it("returns no collisions for disjoint sessions", async () => {
    await insertSession("s1", "alice");
    await insertSession("s2", "bob");
    await insertContext({ sessionId: "s1", branch: "feat/a", worktreePath: "/wt/s1", issueId: "x386.1" });
    await insertContext({ sessionId: "s2", branch: "feat/b", worktreePath: "/wt/s2", issueId: "x386.2" });
    expect(await detectCollisions("s1")).toEqual([]);
  });

  it("does not collide a session with itself", async () => {
    await insertSession("s1", "alice");
    await insertContext({ sessionId: "s1", branch: "feat/a", worktreePath: "/wt/s1" });
    expect(await detectCollisions("s1")).toEqual([]);
  });

  it("returns [] when the session has no cached context", async () => {
    expect(await detectCollisions("ghost")).toEqual([]);
  });

  it("ignores null branch/path/issue (no false collisions on shared nulls)", async () => {
    await insertSession("s1", "alice");
    await insertSession("s2", "bob");
    // Both have null worktree_path and null issue — must NOT collide.
    await insertContext({ sessionId: "s1", branch: "feat/a", worktreePath: null, issueId: null });
    await insertContext({ sessionId: "s2", branch: "feat/b", worktreePath: null, issueId: null });
    expect(await detectCollisions("s1")).toEqual([]);
  });

  // [x386.14 HIGH fix] closeSession sets status='closed' but does NOT delete the
  // terminal_session row, so the work-context snapshot lingers. A closed peer
  // sharing a branch/worktree/issue must NOT raise a phantom collision.
  it("does NOT collide against a CLOSED peer sharing the branch", async () => {
    await insertSession("s1", "alice", "active");
    await insertSession("s2", "bob", "closed");
    await insertContext({ sessionId: "s1", branch: "feat/x386.11", worktreePath: "/wt/s1" });
    await insertContext({ sessionId: "s2", branch: "feat/x386.11", worktreePath: "/wt/s2" });
    expect(await detectCollisions("s1")).toEqual([]);
  });

  it("does NOT collide against a closed peer sharing the worktree or claimed issue", async () => {
    await insertSession("s1", "alice", "active");
    await insertSession("s2", "bob", "closed");
    await insertContext({ sessionId: "s1", branch: "feat/a", worktreePath: "/shared/wt", issueId: "x386.6" });
    await insertContext({ sessionId: "s2", branch: "feat/b", worktreePath: "/shared/wt", issueId: "x386.6" });
    expect(await detectCollisions("s1")).toEqual([]);
  });

  it("still collides against a SUSPENDED peer (suspended is live)", async () => {
    await insertSession("s1", "alice", "active");
    await insertSession("s2", "bob", "suspended");
    await insertContext({ sessionId: "s1", branch: "feat/shared", worktreePath: "/wt/s1" });
    await insertContext({ sessionId: "s2", branch: "feat/shared", worktreePath: "/wt/s2" });
    const out = await detectCollisions("s1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ peerName: "bob", reason: "branch", value: "feat/shared" });
  });
});
