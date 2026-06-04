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

const DDL = [
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
  `CREATE TABLE channel_subscription (
    id TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'auto_deliver',
    created_at INTEGER NOT NULL
  );`,
  `CREATE UNIQUE INDEX channel_subscription_unique_idx ON channel_subscription (channel_id, session_id);`,
];

async function resetDb(): Promise<void> {
  tmpDir = mkdtempSync(join(tmpdir(), "rdv-chsub-test-"));
  client = createClient({ url: `file:${join(tmpDir, "test.db")}` });
  testDb = drizzle(client, { schema });
  for (const stmt of DDL) await client.execute(stmt);
}

function cleanupDb(): void {
  client?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

import {
  subscribe,
  unsubscribe,
  getSubscriptions,
  getAutoDeliverSessions,
} from "./channel-subscription-service";

async function insertChannel(opts: {
  id: string;
  name: string;
  isDefault?: boolean;
  type?: string;
}): Promise<void> {
  await client.execute({
    sql: `INSERT INTO channel (id, project_id, group_id, name, display_name, type, is_default, created_at)
          VALUES (?, 'proj-1', 'grp-1', ?, ?, ?, ?, 0)`,
    args: [opts.id, opts.name, `#${opts.name}`, opts.type ?? "public", opts.isDefault ? 1 : 0],
  });
}

const PEERS = ["s1", "s2", "s3"];

describe("ChannelSubscriptionService (x386.5)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    cleanupDb();
  });

  describe("subscribe / unsubscribe", () => {
    it("upserts a subscription and is idempotent on the unique index", async () => {
      await insertChannel({ id: "ch", name: "auth-refactor" });
      await subscribe("ch", "s1", "auto_deliver");
      await subscribe("ch", "s1", "direct_only"); // update mode, not a 2nd row
      const subs = await getSubscriptions("ch");
      expect(subs).toHaveLength(1);
      expect(subs[0]).toEqual({ sessionId: "s1", mode: "direct_only" });
    });

    it("unsubscribe removes the row", async () => {
      await insertChannel({ id: "ch", name: "auth-refactor" });
      await subscribe("ch", "s1");
      await unsubscribe("ch", "s1");
      expect(await getSubscriptions("ch")).toHaveLength(0);
    });
  });

  describe("getAutoDeliverSessions", () => {
    it("excludes a direct_only subscriber on a non-default channel", async () => {
      await insertChannel({ id: "ch", name: "auth-refactor" });
      await subscribe("ch", "s1", "auto_deliver");
      await subscribe("ch", "s2", "direct_only");
      // s3 has no row → opt-in only → excluded.
      const out = await getAutoDeliverSessions("ch", PEERS);
      expect(out.sort()).toEqual(["s1"]);
    });

    it("#general (default) auto-subscribes ALL peers unless direct_only", async () => {
      await insertChannel({ id: "gen", name: "general", isDefault: true });
      await subscribe("gen", "s2", "direct_only"); // opt OUT
      const out = await getAutoDeliverSessions("gen", PEERS);
      expect(out.sort()).toEqual(["s1", "s3"]);
    });

    it("#general matched by name even when is_default is not set", async () => {
      await insertChannel({ id: "gen", name: "general", isDefault: false });
      const out = await getAutoDeliverSessions("gen", PEERS);
      expect(out.sort()).toEqual(["s1", "s2", "s3"]);
    });

    it("a non-default channel with no subscriptions delivers to nobody", async () => {
      await insertChannel({ id: "ch", name: "random" });
      expect(await getAutoDeliverSessions("ch", PEERS)).toEqual([]);
    });

    it("an explicit auto_deliver row on a non-default channel includes that session", async () => {
      await insertChannel({ id: "ch", name: "random" });
      await subscribe("ch", "s3", "auto_deliver");
      expect(await getAutoDeliverSessions("ch", PEERS)).toEqual(["s3"]);
    });
  });

  // [x386.7] @mention override is enforced at the SEND site (terminal.ts unions
  // mentioned sessions into the recipient set), independent of subscription.
  // Here we assert the building block: a direct_only subscriber is NOT in the
  // auto-deliver set, so the union with mentions is what gives them the message.
  describe("mention override building block (x386.7)", () => {
    it("a direct_only subscriber is excluded from auto-deliver (mention adds them back)", async () => {
      await insertChannel({ id: "ch", name: "auth-refactor" });
      await subscribe("ch", "s2", "direct_only");
      const auto = await getAutoDeliverSessions("ch", PEERS);
      expect(auto).not.toContain("s2");
      // Caller unions mentions: union(auto, ["s2"]) includes s2.
      const recipients = new Set([...auto, "s2"]);
      expect(recipients.has("s2")).toBe(true);
    });
  });
});
