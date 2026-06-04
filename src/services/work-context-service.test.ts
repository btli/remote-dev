// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@/db/schema";

let client: Client;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let tmpDir: string;

vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
}));

// Mock the bd layer so the loose join is deterministic.
const beadsAvailable = { value: true };
const beadsRows: Record<string, Array<{ id: string; title: string; assignee: string | null; status: string }>> = {};
let beadsThrows = false;

vi.mock("@/lib/beads-db", () => ({
  isBeadsAvailable: vi.fn(async () => beadsAvailable.value),
  beadsQuery: vi.fn(async (_path: string, sql: string, params: unknown[]) => {
    if (beadsThrows) throw new Error("dolt schema drift: unknown column");
    // Branch-id query carries a param; project-fallback has none.
    if (params.length > 0) {
      const key = `id:${String(params[0])}`;
      return beadsRows[key] ?? [];
    }
    return beadsRows["project"] ?? [];
  }),
}));

const DDL = [
  `CREATE TABLE terminal_session (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    tmux_session_name TEXT NOT NULL,
    project_path TEXT,
    worktree_branch TEXT,
    project_id TEXT NOT NULL,
    terminal_type TEXT DEFAULT 'shell',
    agent_activity_status TEXT,
    type_metadata TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    pinned INTEGER NOT NULL DEFAULT 0,
    tab_order INTEGER NOT NULL DEFAULT 0,
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
  tmpDir = mkdtempSync(join(tmpdir(), "rdv-wc-test-"));
  client = createClient({ url: `file:${join(tmpDir, "test.db")}` });
  testDb = drizzle(client, { schema });
  for (const stmt of DDL) await client.execute(stmt);
}

function cleanupDb(): void {
  client?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

import {
  computeWorkContext,
  getProjectWorkContexts,
  extractIssueIdFromBranch,
} from "./work-context-service";

async function insertSession(opts: {
  id: string;
  branch?: string | null;
  path?: string | null;
  status?: string | null;
  projectId?: string;
}): Promise<void> {
  await client.execute({
    sql: `INSERT INTO terminal_session
      (id, user_id, name, tmux_session_name, project_path, worktree_branch, project_id,
       terminal_type, agent_activity_status, status, last_activity_at, created_at, updated_at)
      VALUES (?, 'u1', ?, ?, ?, ?, ?, 'agent', ?, 'active', 0, 0, 0)`,
    args: [
      opts.id,
      opts.id,
      `tmux-${opts.id}`,
      opts.path ?? null,
      opts.branch ?? null,
      opts.projectId ?? "proj-1",
      opts.status ?? "running",
    ],
  });
}

describe("WorkContextService (x386.11)", () => {
  beforeEach(async () => {
    await resetDb();
    beadsAvailable.value = true;
    beadsThrows = false;
    for (const k of Object.keys(beadsRows)) delete beadsRows[k];
  });
  afterEach(() => {
    cleanupDb();
    vi.clearAllMocks();
  });

  describe("extractIssueIdFromBranch", () => {
    it("pulls the bd issue id from common branch shapes", () => {
      // Dotted sub-issue id (x386.11) is the bd id even when the branch adds a slug.
      expect(extractIssueIdFromBranch("feat/x386.11-foo")).toBe("x386.11");
      // Hyphenated full id.
      expect(extractIssueIdFromBranch("feat/remote-dev-x386")).toBe("remote-dev-x386");
      // A plain hyphenated slug still yields the leading token (loose; falls
      // back to project-level if bd has no such id).
      expect(extractIssueIdFromBranch("feat/x386-chat")).toBe("x386-chat");
      // No id-shaped token.
      expect(extractIssueIdFromBranch("master")).toBeNull();
      expect(extractIssueIdFromBranch(null)).toBeNull();
    });
  });

  describe("computeWorkContext join confidence", () => {
    it("branch: an in-progress issue matching the branch id → joinConfidence 'branch'", async () => {
      // branch feat/x386 → extract "x386" wouldn't match the dotted regex; use a
      // hyphenated id so the extractor returns it, and seed that id.
      await insertSession({ id: "s1", branch: "feat/x386-foo", path: "/wt/s1" });
      beadsRows["id:x386-foo"] = [{ id: "x386-foo", title: "Chat epic", assignee: "alice", status: "in_progress" }];
      const ctx = await computeWorkContext("s1");
      expect(ctx).toMatchObject({
        claimedIssueId: "x386-foo",
        claimedIssueTitle: "Chat epic",
        joinConfidence: "branch",
        branch: "feat/x386-foo",
        worktreePath: "/wt/s1",
        activityStatus: "running",
      });
    });

    it("project: no branch id but one in-progress issue → joinConfidence 'project'", async () => {
      await insertSession({ id: "s1", branch: "master", path: "/wt/s1" });
      beadsRows["project"] = [{ id: "abc-9", title: "Loose match", assignee: null, status: "in_progress" }];
      const ctx = await computeWorkContext("s1");
      expect(ctx).toMatchObject({ claimedIssueId: "abc-9", joinConfidence: "project" });
    });

    it("none: bd unavailable → joinConfidence 'none', no throw", async () => {
      beadsAvailable.value = false;
      await insertSession({ id: "s1", branch: "feat/x386-foo", path: "/wt/s1" });
      const ctx = await computeWorkContext("s1");
      expect(ctx).toMatchObject({ claimedIssueId: null, joinConfidence: "none" });
    });

    it("none: no project_path → joinConfidence 'none'", async () => {
      await insertSession({ id: "s1", branch: "feat/x386-foo", path: null });
      const ctx = await computeWorkContext("s1");
      expect(ctx?.joinConfidence).toBe("none");
    });

    it("degrades to 'none' when a bd query throws (schema drift)", async () => {
      beadsThrows = true;
      await insertSession({ id: "s1", branch: "feat/x386-foo", path: "/wt/s1" });
      const ctx = await computeWorkContext("s1");
      expect(ctx).toMatchObject({ claimedIssueId: null, joinConfidence: "none" });
    });

    it("returns null for a session with no project", async () => {
      // No row inserted.
      expect(await computeWorkContext("ghost")).toBeNull();
    });
  });

  describe("persistence + getProjectWorkContexts", () => {
    it("caches the snapshot and reads it back per project", async () => {
      beadsAvailable.value = false;
      await insertSession({ id: "s1", branch: "feat/a", path: "/wt/s1" });
      await insertSession({ id: "s2", branch: "feat/b", path: "/wt/s2" });
      await computeWorkContext("s1");
      await computeWorkContext("s2");
      const all = await getProjectWorkContexts("proj-1");
      expect(all.map((c) => c.sessionId).sort()).toEqual(["s1", "s2"]);
    });

    it("re-computing updates the cached row in place (no duplicate)", async () => {
      beadsAvailable.value = false;
      await insertSession({ id: "s1", branch: "feat/a", path: "/wt/s1" });
      await computeWorkContext("s1");
      // Change branch, recompute.
      await client.execute("UPDATE terminal_session SET worktree_branch='feat/b' WHERE id='s1'");
      await computeWorkContext("s1");
      const all = await getProjectWorkContexts("proj-1");
      expect(all).toHaveLength(1);
      expect(all[0].branch).toBe("feat/b");
    });
  });
});
