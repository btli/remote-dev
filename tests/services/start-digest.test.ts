// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@/db/schema";

// [x386.12/.13] The start digest combines work-context (who's-working-on-what +
// claimed bd issues), recent gotchas posted to #agents, and collisions.

let client: Client;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let tmpDir: string;

vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
}));

// bd unavailable for the digest test — work-context branch is enough; the
// claimed-issue path is covered in work-context-service.test.ts.
vi.mock("@/lib/beads-db", () => ({
  isBeadsAvailable: vi.fn(async () => false),
  beadsQuery: vi.fn(async () => []),
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
    agent_provider TEXT,
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
  `CREATE TABLE channel_group (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );`,
  `CREATE UNIQUE INDEX channel_group_project_name_idx ON channel_group (project_id, name);`,
  `CREATE TABLE channel (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'public',
    topic TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_by_session_id TEXT,
    last_message_at INTEGER,
    message_count INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    created_at INTEGER NOT NULL
  );`,
  `CREATE UNIQUE INDEX channel_project_name_idx ON channel (project_id, name);`,
  `CREATE TABLE agent_peer_message (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    from_session_id TEXT,
    from_session_name TEXT NOT NULL,
    to_session_id TEXT,
    body TEXT NOT NULL,
    is_user_message INTEGER NOT NULL DEFAULT 0,
    channel_id TEXT,
    parent_message_id TEXT,
    reply_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );`,
];

async function resetDb(): Promise<void> {
  tmpDir = mkdtempSync(join(tmpdir(), "rdv-digest-test-"));
  client = createClient({ url: `file:${join(tmpDir, "test.db")}` });
  testDb = drizzle(client, { schema });
  for (const stmt of DDL) await client.execute(stmt);
}

function cleanupDb(): void {
  client?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

import { buildStartDigest, getRecentGotchas } from "@/services/work-context-service";
import { getAgentsChannelId } from "@/services/channel-service";

async function insertSession(opts: {
  id: string;
  name: string;
  branch?: string | null;
  status?: string | null;
}): Promise<void> {
  await client.execute({
    sql: `INSERT INTO terminal_session
      (id, user_id, name, tmux_session_name, project_path, worktree_branch, project_id,
       terminal_type, agent_provider, agent_activity_status, status, last_activity_at, created_at, updated_at)
      VALUES (?, 'u1', ?, ?, '/wt/'||?, ?, 'proj-1', 'agent', 'claude', ?, 'active', 0, 0, 0)`,
    args: [opts.id, opts.name, `tmux-${opts.id}`, opts.id, opts.branch ?? null, opts.status ?? "running"],
  });
}

async function postGotcha(channelId: string, from: string, body: string, agoMs: number): Promise<void> {
  await client.execute({
    sql: `INSERT INTO agent_peer_message (id, project_id, from_session_name, body, channel_id, created_at)
          VALUES (?, 'proj-1', ?, ?, ?, ?)`,
    args: [`msg-${Math.random().toString(36).slice(2)}`, from, body, channelId, Date.now() - agoMs],
  });
}

describe("buildStartDigest (x386.12)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    cleanupDb();
    vi.clearAllMocks();
  });

  it("includes peers (with branch) and recent gotchas, excludes self", async () => {
    await insertSession({ id: "me", name: "me", branch: "feat/me" });
    await insertSession({ id: "alice", name: "alice", branch: "feat/x386.11", status: "running" });
    await insertSession({ id: "bob", name: "bob", branch: "feat/auth", status: "idle" });

    // Pre-compute alice/bob contexts so the digest can enrich them with branch.
    const WC = await import("@/services/work-context-service");
    await WC.computeWorkContext("alice");
    await WC.computeWorkContext("bob");

    // A gotcha note in #agents.
    const agentsId = await getAgentsChannelId("proj-1");
    await postGotcha(agentsId, "carol", "[gotcha] db:push drops the FK after rebase", 1000);
    await postGotcha(agentsId, "dave", "plain chatter, not a note", 500);

    const digest = await buildStartDigest("me");

    const names = digest.peers.map((p) => p.name).sort();
    expect(names).toEqual(["alice", "bob"]);
    expect(names).not.toContain("me");

    const alice = digest.peers.find((p) => p.name === "alice");
    expect(alice).toMatchObject({ branch: "feat/x386.11", status: "running" });

    // Only the [gotcha]-tagged message is surfaced.
    expect(digest.gotchas).toHaveLength(1);
    expect(digest.gotchas[0]).toMatchObject({ from: "carol" });
    expect(digest.gotchas[0].body).toContain("[gotcha]");
  });

  it("surfaces a branch collision in the digest's collisions section", async () => {
    await insertSession({ id: "me", name: "me", branch: "feat/shared" });
    await insertSession({ id: "alice", name: "alice", branch: "feat/shared" });
    const WC = await import("@/services/work-context-service");
    await WC.computeWorkContext("alice"); // alice cached on feat/shared

    const digest = await buildStartDigest("me"); // recomputes "me" → collision
    expect(digest.collisions).toHaveLength(1);
    expect(digest.collisions[0]).toMatchObject({ peerName: "alice", reason: "branch", value: "feat/shared" });
  });

  it("returns empty sections when the session has no project", async () => {
    const digest = await buildStartDigest("ghost");
    expect(digest).toEqual({ peers: [], gotchas: [], collisions: [] });
  });
});

describe("getRecentGotchas (x386.13 surfacing)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    cleanupDb();
    vi.clearAllMocks();
  });

  it("returns only tagged notes, newest first, capped at the limit", async () => {
    const agentsId = await getAgentsChannelId("proj-1");
    await postGotcha(agentsId, "a", "[gotcha] one", 5000);
    await postGotcha(agentsId, "b", "[heads-up] two", 4000);
    await postGotcha(agentsId, "c", "[progress] three", 3000);
    await postGotcha(agentsId, "d", "just chatting", 2000);
    await postGotcha(agentsId, "e", "[gotcha] four", 1000);

    const gotchas = await getRecentGotchas("proj-1", 3);
    expect(gotchas).toHaveLength(3);
    // Newest first: e (1000ms ago), c (3000), b (4000).
    expect(gotchas.map((g) => g.from)).toEqual(["e", "c", "b"]);
    expect(gotchas.every((g) => /^\[(gotcha|heads-up|progress)\]/i.test(g.body))).toBe(true);
  });

  it("returns [] when there are no notes", async () => {
    await getAgentsChannelId("proj-1");
    expect(await getRecentGotchas("proj-1")).toEqual([]);
  });

  // [x386 LOW fix] Tagged notes must not be lost under heavy check-in/check-out
  // chatter. The SQL prefix filter (`body LIKE '[%'`) means non-note posts never
  // consume the fetch window, so an older gotcha still surfaces.
  it("surfaces older gotchas even when newer check-in/out chatter dominates #agents", async () => {
    const agentsId = await getAgentsChannelId("proj-1");
    // One gotcha far in the past.
    await postGotcha(agentsId, "carol", "[gotcha] the important footgun", 100_000);
    // 30 newer non-note posts (check-ins / check-outs) — far more than limit*4.
    for (let i = 0; i < 30; i++) {
      await postGotcha(agentsId, `agent${i}`, `checked in — branch feat/b${i}`, 30_000 - i * 100);
    }
    const gotchas = await getRecentGotchas("proj-1", 5);
    expect(gotchas).toHaveLength(1);
    expect(gotchas[0]).toMatchObject({ from: "carol" });
    expect(gotchas[0].body).toContain("[gotcha]");
  });
});
