// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@/db/schema";

// Real libsql on a TEMP FILE (not :memory:) — the delivery state machine and
// the unique-index idempotency are SQL behavior that must run against a real
// engine. A file URL is used (rather than `:memory:`) so every connection sees
// the same schema + data, which matters for any future multi-connection paths.
let client: Client;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let tmpDir: string;

vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
}));

// Minimal DDL: agent_peer_message (source rows) + the two x386.1 tables.
const DDL = [
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
  `CREATE TABLE message_delivery (
    id TEXT PRIMARY KEY NOT NULL,
    message_id TEXT NOT NULL,
    to_session_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    channel_kind TEXT,
    delivered_at INTEGER,
    acked_at INTEGER,
    created_at INTEGER NOT NULL
  );`,
  `CREATE UNIQUE INDEX message_delivery_msg_session_idx ON message_delivery (message_id, to_session_id);`,
  `CREATE INDEX message_delivery_session_state_idx ON message_delivery (to_session_id, state, created_at);`,
];

async function resetDb(): Promise<void> {
  tmpDir = mkdtempSync(join(tmpdir(), "rdv-md-test-"));
  client = createClient({ url: `file:${join(tmpDir, "test.db")}` });
  testDb = drizzle(client, { schema });
  for (const stmt of DDL) await client.execute(stmt);
}

function cleanupDb(): void {
  client?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

import {
  recordDeliveries,
  markDelivered,
  ackDelivery,
  ackDeliveries,
  getUndelivered,
} from "./message-delivery-service";
import { cleanupOldMessages } from "./peer-service";

const PROJECT = "proj-1";

/** Insert a source message and return its id. `agoMs` backdates createdAt. */
async function insertMessage(opts: {
  id: string;
  toSessionId?: string | null;
  channelId?: string | null;
  body?: string;
  from?: string;
  agoMs?: number;
}): Promise<string> {
  const createdAt = Date.now() - (opts.agoMs ?? 0);
  await client.execute({
    sql: `INSERT INTO agent_peer_message
      (id, project_id, from_session_id, from_session_name, to_session_id, body, channel_id, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    args: [
      opts.id,
      PROJECT,
      opts.from ?? "alice",
      opts.toSessionId ?? null,
      opts.body ?? "hello",
      opts.channelId ?? null,
      createdAt,
    ],
  });
  return opts.id;
}

describe("MessageDeliveryService", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    cleanupDb();
  });

  describe("recordDeliveries", () => {
    it("creates one pending row per recipient", async () => {
      await insertMessage({ id: "m1" });
      await recordDeliveries("m1", PROJECT, ["s1", "s2"]);
      const rows = await getUndelivered("s1");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "m1", state: "pending" });
      expect(await getUndelivered("s2")).toHaveLength(1);
    });

    it("is idempotent — calling twice yields a single row per (message, session)", async () => {
      await insertMessage({ id: "m1" });
      await recordDeliveries("m1", PROJECT, ["s1"]);
      await recordDeliveries("m1", PROJECT, ["s1"]);
      const all = await client.execute("SELECT COUNT(*) AS n FROM message_delivery WHERE message_id = 'm1'");
      expect(Number(all.rows[0].n)).toBe(1);
    });

    it("de-dups recipients within a single call", async () => {
      await insertMessage({ id: "m1" });
      await recordDeliveries("m1", PROJECT, ["s1", "s1", "s1"]);
      const all = await client.execute("SELECT COUNT(*) AS n FROM message_delivery WHERE message_id = 'm1'");
      expect(Number(all.rows[0].n)).toBe(1);
    });

    it("is a no-op for an empty recipient list", async () => {
      await insertMessage({ id: "m1" });
      await recordDeliveries("m1", PROJECT, []);
      const all = await client.execute("SELECT COUNT(*) AS n FROM message_delivery");
      expect(Number(all.rows[0].n)).toBe(0);
    });
  });

  describe("markDelivered", () => {
    it("advances pending → delivered and records the channel", async () => {
      await insertMessage({ id: "m1" });
      await recordDeliveries("m1", PROJECT, ["s1"]);
      await markDelivered("m1", "s1", "mcp_push");
      const row = await client.execute("SELECT state, channel_kind FROM message_delivery WHERE message_id='m1'");
      expect(row.rows[0].state).toBe("delivered");
      expect(row.rows[0].channel_kind).toBe("mcp_push");
    });

    it("does NOT regress an already-acked row", async () => {
      await insertMessage({ id: "m1" });
      await recordDeliveries("m1", PROJECT, ["s1"]);
      await ackDelivery("m1", "s1");
      await markDelivered("m1", "s1", "poll");
      const row = await client.execute("SELECT state FROM message_delivery WHERE message_id='m1'");
      expect(row.rows[0].state).toBe("acked");
    });
  });

  describe("ackDelivery", () => {
    it("advances the delivery row to acked and stamps acked_at", async () => {
      await insertMessage({ id: "m1", agoMs: 1000 });
      await recordDeliveries("m1", PROJECT, ["s1"]);
      await ackDelivery("m1", "s1");
      const row = await client.execute("SELECT state, acked_at FROM message_delivery WHERE message_id='m1'");
      expect(row.rows[0].state).toBe("acked");
      expect(row.rows[0].acked_at).not.toBeNull();
    });

    it("makes the message disappear from getUndelivered (acked IS the cursor)", async () => {
      await insertMessage({ id: "m1", agoMs: 1000 });
      await recordDeliveries("m1", PROJECT, ["s1"]);
      expect((await getUndelivered("s1")).map((r) => r.id)).toEqual(["m1"]);
      await ackDelivery("m1", "s1");
      expect(await getUndelivered("s1")).toHaveLength(0);
    });

    it("acking only one of several messages leaves the rest undelivered", async () => {
      await insertMessage({ id: "m1", agoMs: 10_000 });
      await insertMessage({ id: "m2", agoMs: 1_000 });
      await recordDeliveries("m1", PROJECT, ["s1"]);
      await recordDeliveries("m2", PROJECT, ["s1"]);
      await ackDelivery("m2", "s1");
      expect((await getUndelivered("s1")).map((r) => r.id)).toEqual(["m1"]);
    });

    it("is a no-op for a (message, session) with no delivery row", async () => {
      await ackDelivery("missing", "never"); // no throw
      const all = await client.execute("SELECT COUNT(*) AS n FROM message_delivery");
      expect(Number(all.rows[0].n)).toBe(0);
    });
  });

  describe("getUndelivered", () => {
    it("returns only non-acked rows, oldest first", async () => {
      await insertMessage({ id: "old", agoMs: 5000 });
      await insertMessage({ id: "new", agoMs: 1000 });
      await recordDeliveries("old", PROJECT, ["s1"]);
      await recordDeliveries("new", PROJECT, ["s1"]);
      await ackDelivery("old", "s1");
      const rows = await getUndelivered("s1");
      expect(rows.map((r) => r.id)).toEqual(["new"]);
    });

    it("orders multiple undelivered oldest-first", async () => {
      await insertMessage({ id: "a", agoMs: 3000 });
      await insertMessage({ id: "b", agoMs: 2000 });
      await insertMessage({ id: "c", agoMs: 1000 });
      await recordDeliveries("a", PROJECT, ["s1"]);
      await recordDeliveries("b", PROJECT, ["s1"]);
      await recordDeliveries("c", PROJECT, ["s1"]);
      const rows = await getUndelivered("s1");
      expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    });

    it("joins channel + parent fields from the source message", async () => {
      await insertMessage({ id: "m1", channelId: "ch-1", body: "ping" });
      await recordDeliveries("m1", PROJECT, ["s1"]);
      const [row] = await getUndelivered("s1");
      expect(row).toMatchObject({ channelId: "ch-1", body: "ping", fromSessionName: "alice" });
    });
  });

  describe("exactly-once across push + poll (x386.4 parity)", () => {
    it("a broadcast to a non-MCP session is returned once, then never again after ack", async () => {
      await insertMessage({ id: "b1", toSessionId: null });
      await recordDeliveries("b1", PROJECT, ["gemini-session"]);

      // First poll: returns the message, marks it delivered (not acked).
      const first = await getUndelivered("gemini-session");
      expect(first.map((r) => r.id)).toEqual(["b1"]);
      await Promise.all(first.map((r) => markDelivered(r.id, "gemini-session", "poll")));

      // Still undelivered (delivered != acked) — so a crash before ack re-shows it.
      expect((await getUndelivered("gemini-session")).map((r) => r.id)).toEqual(["b1"]);

      // CLI acks the batch.
      await ackDeliveries(first.map((r) => r.id), "gemini-session");

      // Second poll: nothing.
      expect(await getUndelivered("gemini-session")).toHaveLength(0);
    });

    it("ackDeliveries acks every id and is safe on an empty list", async () => {
      await ackDeliveries([], "s1"); // no throw
      await insertMessage({ id: "m1", agoMs: 1000 });
      await recordDeliveries("m1", PROJECT, ["s1"]);
      await ackDeliveries(["m1"], "s1");
      expect(await getUndelivered("s1")).toHaveLength(0);
    });
  });
});

// ── x386.9: TTL prune (cleanupOldMessages) ──────────────────────────────────
// The peer-service TTL must never prune a message that still has an unacked
// delivery, so a long-disconnected agent does not lose something it never saw.
describe("cleanupOldMessages TTL (x386.9)", () => {
  beforeEach(async () => {
    await resetDb();
    delete process.env.RDV_CHAT_TTL_DAYS;
  });
  afterEach(() => {
    cleanupDb();
    delete process.env.RDV_CHAT_TTL_DAYS;
  });

  const DAY = 86_400_000;

  it("prunes an OLD message whose deliveries are all acked", async () => {
    await insertMessage({ id: "old", agoMs: 30 * DAY });
    await recordDeliveries("old", PROJECT, ["s1"]);
    await ackDelivery("old", "s1");
    const pruned = await cleanupOldMessages();
    expect(pruned).toBe(1);
    const left = await client.execute("SELECT COUNT(*) AS n FROM agent_peer_message");
    expect(Number(left.rows[0].n)).toBe(0);
  });

  it("RETAINS an old message with an unacked (delivered) delivery", async () => {
    await insertMessage({ id: "old", agoMs: 30 * DAY });
    await recordDeliveries("old", PROJECT, ["s1"]);
    await markDelivered("old", "s1", "mcp_push"); // delivered, not acked
    const pruned = await cleanupOldMessages();
    expect(pruned).toBe(0);
    const left = await client.execute("SELECT COUNT(*) AS n FROM agent_peer_message");
    expect(Number(left.rows[0].n)).toBe(1);
  });

  it("RETAINS a recent message even when fully acked", async () => {
    await insertMessage({ id: "recent", agoMs: 1 * DAY });
    await recordDeliveries("recent", PROJECT, ["s1"]);
    await ackDelivery("recent", "s1");
    const pruned = await cleanupOldMessages();
    expect(pruned).toBe(0);
  });

  it("prunes an old message with NO delivery rows at all", async () => {
    await insertMessage({ id: "orphan", agoMs: 30 * DAY });
    const pruned = await cleanupOldMessages();
    expect(pruned).toBe(1);
  });

  it("honors RDV_CHAT_TTL_DAYS override", async () => {
    process.env.RDV_CHAT_TTL_DAYS = "2";
    await insertMessage({ id: "threeDays", agoMs: 3 * DAY });
    await recordDeliveries("threeDays", PROJECT, ["s1"]);
    await ackDelivery("threeDays", "s1");
    const pruned = await cleanupOldMessages();
    expect(pruned).toBe(1);
  });
});
