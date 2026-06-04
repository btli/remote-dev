// @vitest-environment node
/**
 * [y5ch.5/.10] Integration tests for the notification service against a REAL
 * in-memory libsql DB (so coalescing SQL + the policy push-gate run end-to-end).
 *
 * Strategy:
 *   - Build a libsql `:memory:` client + drizzle over the real generated SQLite
 *     schema, create the notification_event table, and expose it as `@/db`.
 *   - Mock the prefs resolver so we can drive minPushSeverity / per-type opt-out
 *     without a prefs row.
 *   - Inject a fake push gateway + token repo and assert push fires ONLY when the
 *     policy allows it (actionable/error, not opted-out, not below min severity).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as sqliteSchema from "@/db/schema.sqlite";

// One shared in-memory DB for the whole file; truncated between tests.
const rawClient = createClient({ url: ":memory:" });
const memDb = drizzle(rawClient, { schema: sqliteSchema });

vi.mock("@/db", () => ({ db: memDb }));

// Default prefs: actionable+ push, no opt-outs, no quiet hours, no mutes.
interface FakePrefs {
  pushByType: Record<string, boolean>;
  mutedSessionIds: Set<string>;
  quietHours: { startHour: number; endHour: number } | null;
  minPushSeverity: "actionable" | "passive" | "error";
}
const resolvePrefs = vi.fn<(userId: string) => Promise<FakePrefs>>(async () => ({
  pushByType: {},
  mutedSessionIds: new Set<string>(),
  quietHours: null,
  minPushSeverity: "actionable",
}));
vi.mock("@/services/notification-preferences-service", () => ({
  resolvePrefs: (userId: string) => resolvePrefs(userId),
}));

async function createSchema() {
  await rawClient.execute(`CREATE TABLE IF NOT EXISTS notification_event (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    session_id text,
    session_name text,
    type text NOT NULL,
    severity text DEFAULT 'passive' NOT NULL,
    title text NOT NULL,
    body text,
    coalesce_key text,
    count integer DEFAULT 1 NOT NULL,
    meta text,
    read_at integer,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`);
}

// Fake push DI captured per-test.
const sendToTokens = vi.fn(async () => ({ staleTokens: [] as string[] }));
const fakeGateway = { sendToTokens };
const fakeTokenRepo = {
  findByUser: vi.fn(async () => [{ fcmToken: "tok-1" }]),
  deleteByTokens: vi.fn(async () => {}),
};

async function loadService() {
  vi.resetModules();
  const svc = await import("../notification-service");
  // Re-inject DI on the fresh module instance.
  svc.setPushGateway(fakeGateway as never);
  svc.setPushTokenRepository(fakeTokenRepo as never);
  return svc;
}

beforeEach(async () => {
  await createSchema();
  await rawClient.execute("DELETE FROM notification_event");
  sendToTokens.mockClear();
  fakeTokenRepo.findByUser.mockClear();
  resolvePrefs.mockClear();
  resolvePrefs.mockImplementation(async () => ({
    pushByType: {},
    mutedSessionIds: new Set<string>(),
    quietHours: null,
    minPushSeverity: "actionable",
  }));
});

describe("createNotification — push gate (y5ch.10)", () => {
  it("does NOT push a passive agent_exited (below min severity)", async () => {
    const svc = await loadService();
    const n = await svc.createNotification({
      userId: "u1",
      sessionId: "s1",
      type: "agent_exited",
      title: "stopped",
    });
    expect(n).not.toBeNull();
    expect(n?.severity).toBe("passive");
    // Allow the fire-and-forget dispatch microtask to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(sendToTokens).not.toHaveBeenCalled();
  });

  it("pushes an actionable agent_waiting", async () => {
    const svc = await loadService();
    await svc.createNotification({
      userId: "u1",
      sessionId: "s1",
      type: "agent_waiting",
      title: "needs you",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendToTokens).toHaveBeenCalledTimes(1);
  });

  it("does NOT push when the type is opted out", async () => {
    resolvePrefs.mockImplementation(async () => ({
      pushByType: { agent_waiting: false },
      mutedSessionIds: new Set<string>(),
      quietHours: null,
      minPushSeverity: "actionable",
    }));
    const svc = await loadService();
    await svc.createNotification({
      userId: "u1",
      sessionId: "s1",
      type: "agent_waiting",
      title: "needs you",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendToTokens).not.toHaveBeenCalled();
  });

  it("does NOT store or push for a muted session (returns null)", async () => {
    resolvePrefs.mockImplementation(async () => ({
      pushByType: {},
      mutedSessionIds: new Set<string>(["s1"]),
      quietHours: null,
      minPushSeverity: "actionable",
    }));
    const svc = await loadService();
    const n = await svc.createNotification({
      userId: "u1",
      sessionId: "s1",
      type: "agent_waiting",
      title: "needs you",
    });
    expect(n).toBeNull();
    const rows = await svc.listNotifications("u1");
    expect(rows.length).toBe(0);
  });
});

describe("createNotification — coalescing (y5ch.5)", () => {
  it("collapses two waiting events for one session into a count=2 row", async () => {
    const svc = await loadService();
    await svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_waiting", title: "first" });
    const second = await svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_waiting", title: "second" });
    expect(second?.count).toBe(2);
    expect(second?.title).toBe("second"); // refreshed in place
    const rows = await svc.listNotifications("u1");
    expect(rows.length).toBe(1);
    expect(rows[0].count).toBe(2);
  });

  it("collapses agent_waiting + agent_exited into the same lifecycle group", async () => {
    const svc = await loadService();
    await svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_waiting", title: "waiting" });
    // agent_exited shares the agent_lifecycle group, so it merges (not a new row).
    const merged = await svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_exited", title: "exited" });
    expect(merged?.count).toBe(2);
    const rows = await svc.listNotifications("u1");
    expect(rows.length).toBe(1);
  });

  it("does NOT collapse different groups (waiting vs build_fail)", async () => {
    const svc = await loadService();
    await svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_waiting", title: "waiting" });
    await svc.createNotification({ userId: "u1", sessionId: "s1", type: "build_fail", title: "build broke" });
    const rows = await svc.listNotifications("u1");
    expect(rows.length).toBe(2);
  });

  it("starts a fresh row after the prior one is read (clear boundary)", async () => {
    const svc = await loadService();
    const first = await svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_waiting", title: "first" });
    await svc.markRead("u1", [first!.id]);
    const second = await svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_waiting", title: "second" });
    expect(second?.count).toBe(1);
    const rows = await svc.listNotifications("u1");
    expect(rows.length).toBe(2);
  });

  it("does not coalesce across users", async () => {
    const svc = await loadService();
    await svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_waiting", title: "u1" });
    await svc.createNotification({ userId: "u2", sessionId: "s1", type: "agent_waiting", title: "u2" });
    expect((await svc.listNotifications("u1")).length).toBe(1);
    expect((await svc.listNotifications("u2")).length).toBe(1);
  });

  it("does not coalesce a session-less (null sessionId) notification", async () => {
    const svc = await loadService();
    await svc.createNotification({ userId: "u1", type: "info", title: "a" });
    await svc.createNotification({ userId: "u1", type: "info", title: "b" });
    const rows = await svc.listNotifications("u1");
    expect(rows.length).toBe(2);
  });

  it("[fix #3] increments count atomically from the DB value (not a stale JS read)", async () => {
    const svc = await loadService();
    // Seed an OPEN lifecycle row already at count=5 directly in the DB.
    const now = Date.now();
    await rawClient.execute({
      sql: `INSERT INTO notification_event
        (id, user_id, session_id, type, severity, title, coalesce_key, count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["seed-1", "u1", "s1", "agent_waiting", "actionable", "seeded", "agent_lifecycle", 5, now, now],
    });
    // A coalescing event must read the DB's current 5 and store 6 — an RMW that
    // trusted a stale in-memory count would regress this to 2.
    const merged = await svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_waiting", title: "next" });
    expect(merged?.count).toBe(6);
    const rows = await svc.listNotifications("u1");
    expect(rows.length).toBe(1);
    expect(rows[0].count).toBe(6);
  });

  it("[fix #3] concurrent coalescing events do not lose increments", async () => {
    const svc = await loadService();
    // Establish the open row, then fire several events "concurrently". With an
    // atomic `count + 1` UPDATE every event is counted; a read-modify-write
    // would let interleaved reads clobber each other and undercount.
    await svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_waiting", title: "seed" });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        svc.createNotification({ userId: "u1", sessionId: "s1", type: "agent_waiting", title: `c${i}` }),
      ),
    );
    const rows = await svc.listNotifications("u1");
    expect(rows.length).toBe(1);
    // 1 seed + 5 coalesced = 6.
    expect(rows[0].count).toBe(6);
  });
});
