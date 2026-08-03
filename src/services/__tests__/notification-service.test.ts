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
import { afterAll, describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as sqliteSchema from "@/db/schema.sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// One shared file-backed DB for the whole file; libsql may open a separate
// connection for a transaction, which cannot see a private `:memory:` schema.
const testDbDir = mkdtempSync(join(tmpdir(), "rdv-notification-test-"));
const testDbPath = join(testDbDir, "notifications.db");
const rawClient = createClient({ url: `file:${testDbPath}` });
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
  await rawClient.execute(`CREATE TABLE IF NOT EXISTS notification_delivery (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    notification_id text,
    created_at integer NOT NULL
  )`);
  await rawClient.execute(`CREATE TABLE IF NOT EXISTS agent_status_delivery (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    session_id text NOT NULL,
    generation integer NOT NULL,
    delivery_id text NOT NULL,
    status text NOT NULL,
    source text,
    status_at integer NOT NULL,
    arrival_order integer NOT NULL,
    applied integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL
  )`);
  await rawClient.execute(`CREATE TABLE IF NOT EXISTS terminal_session (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    agent_restart_count integer DEFAULT 0,
    agent_activity_status text,
    agent_activity_order integer
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
  const svc = await import("../notification-service");
  // Re-inject DI for each test; keeping one module instance also keeps the
  // mocked transactional DB bound to this file's in-memory connection.
  svc.setPushGateway(fakeGateway as never);
  svc.setPushTokenRepository(fakeTokenRepo as never);
  return svc;
}

beforeEach(async () => {
  await createSchema();
  await rawClient.execute("DELETE FROM notification_event");
  await rawClient.execute("DELETE FROM notification_delivery");
  await rawClient.execute("DELETE FROM agent_status_delivery");
  await rawClient.execute("DELETE FROM terminal_session");
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

afterAll(() => {
  rawClient.close();
  rmSync(testDbDir, { recursive: true, force: true });
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
  it("stores and pushes an idempotent lifecycle delivery exactly once", async () => {
    const svc = await loadService();
    const input = {
      userId: "u1",
      sessionId: "s1",
      type: "agent_error" as const,
      title: "agent crashed",
      idempotencyKey: "pane-exit:s1:4",
    };

    const first = await svc.createNotification(input);
    const duplicate = await svc.createNotification(input);
    await new Promise((r) => setTimeout(r, 0));

    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    expect(await svc.listNotifications("u1")).toHaveLength(1);
    expect(sendToTokens).toHaveBeenCalledTimes(1);
  });

  it("coalesces distinct idempotent lifecycle deliveries while deduping exact retries", async () => {
    const svc = await loadService();
    const base = {
      userId: "u1",
      sessionId: "s1",
      type: "agent_waiting" as const,
      title: "needs attention",
    };

    const first = await svc.createNotification({ ...base, idempotencyKey: "hook:d1" });
    const duplicate = await svc.createNotification({ ...base, idempotencyKey: "hook:d1" });
    const second = await svc.createNotification({ ...base, idempotencyKey: "hook:d2" });

    expect(first?.count).toBe(1);
    expect(duplicate).toBeNull();
    expect(second?.count).toBe(2);
    const rows = await svc.listNotifications("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
  });

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

  it("serializes concurrent distinct first deliveries into one open row", async () => {
    const svc = await loadService();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        svc.createNotification({
          userId: "u1",
          sessionId: "s-empty",
          type: "agent_waiting",
          title: `first-${i}`,
          idempotencyKey: `first-delivery-${i}`,
        }),
      ),
    );

    const rows = await svc.listNotifications("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(5);
  });

  it("enriches a heuristic exit in place without incrementing or pushing again", async () => {
    const svc = await loadService();
    const idempotencyKey = "pane-exit:s1:4";
    const first = await svc.createNotification({
      userId: "u1",
      sessionId: "s1",
      type: "agent_stuck",
      severity: "error",
      title: "Agent stopped responding",
      idempotencyKey,
    });
    expect(first).toMatchObject({ type: "agent_stuck", count: 1 });
    sendToTokens.mockClear();

    const enriched = await svc.replaceIdempotentNotification({
      userId: "u1",
      sessionId: "s1",
      type: "agent_error",
      severity: "error",
      title: "Agent exited with code 9",
      meta: { result: "9" },
      idempotencyKey,
    });

    expect(enriched).toMatchObject({ type: "agent_error", count: 1 });
    expect(await svc.listNotifications("u1")).toHaveLength(1);
    expect(sendToTokens).not.toHaveBeenCalled();
  });

  it("atomically claims a missing receipt before a stale heuristic exit can insert", async () => {
    const svc = await loadService();
    const idempotencyKey = "pane-exit:s-race:2";

    // Models the exact callback landing after liveness committed its generic
    // exited state but before liveness inserted agent_stuck. The exact path
    // must claim the delivery identity while it holds the shared coalescing
    // lock; otherwise the later heuristic write permanently wins.
    const exact = await svc.replaceIdempotentNotification({
      userId: "u1",
      sessionId: "s-race",
      type: "agent_error",
      severity: "error",
      title: "Agent exited with code 9",
      meta: { result: "9" },
      idempotencyKey,
    });
    const stale = await svc.createNotification({
      userId: "u1",
      sessionId: "s-race",
      type: "agent_stuck",
      severity: "error",
      title: "Agent stopped responding",
      idempotencyKey,
    });

    expect(exact).toMatchObject({ type: "agent_error", count: 1 });
    expect(stale).toBeNull();
    expect(await svc.listNotifications("u1")).toEqual([
      expect.objectContaining({ type: "agent_error", count: 1 }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendToTokens).toHaveBeenCalledTimes(1);
  });

  it("merges legacy cross-group exit enrichment into an existing failure row", async () => {
    const svc = await loadService();
    const heuristicKey = "pane-exit:s1:legacy";
    const heuristic = await svc.createNotification({
      userId: "u1",
      sessionId: "s1",
      type: "agent_stuck",
      severity: "error",
      title: "Agent stopped responding",
      idempotencyKey: heuristicKey,
    });
    expect(heuristic).not.toBeNull();
    // Simulate a row written by the previous release, where agent_stuck used
    // the lifecycle group, then establish an already-open failure aggregate.
    await rawClient.execute({
      sql: "UPDATE notification_event SET coalesce_key = 'agent_lifecycle' WHERE id = ?",
      args: [heuristic!.id],
    });
    const failure = await svc.createNotification({
      userId: "u1",
      sessionId: "s1",
      type: "agent_error",
      severity: "error",
      title: "Earlier failure",
      idempotencyKey: "other-failure",
    });
    expect(failure).not.toBeNull();

    const enriched = await svc.replaceIdempotentNotification({
      userId: "u1",
      sessionId: "s1",
      type: "agent_error",
      severity: "error",
      title: "Agent exited with code 9",
      meta: { result: "9" },
      idempotencyKey: heuristicKey,
    });

    expect(enriched).toMatchObject({ type: "agent_error", count: 2 });
    const rows = await svc.listNotifications("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: failure!.id, count: 2, type: "agent_error" });
    const receipts = await rawClient.execute(
      "SELECT DISTINCT notification_id FROM notification_delivery WHERE user_id = 'u1'",
    );
    expect(receipts.rows).toEqual([{ notification_id: failure!.id }]);
  });

  it("serializes status validation and notification storage against a newer status", async () => {
    const svc = await loadService();
    await rawClient.batch([
      {
        sql: `INSERT INTO terminal_session
          (id, user_id, agent_restart_count, agent_activity_status, agent_activity_order)
          VALUES (?, ?, ?, ?, ?)`,
        args: ["status-race", "u1", 2, "waiting", 100],
      },
      {
        sql: `INSERT INTO agent_status_delivery
          (id, user_id, session_id, generation, delivery_id, status, status_at, arrival_order, applied, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["receipt-race", "u1", "status-race", 2, "wait", "waiting", 100, 100, 1, 100],
      },
    ], "write");

    let releaseLock!: () => void;
    let reportLocked!: () => void;
    const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const notificationPromise = svc.createNotificationForAgentStatus(
      "receipt-race",
      {
        userId: "u1",
        sessionId: "status-race",
        type: "agent_waiting",
        severity: "actionable",
        title: "Agent needs attention",
        idempotencyKey: "receipt-race",
      },
      { afterStatusLock: async () => { reportLocked(); await release; } },
    );
    await locked;

    const competingClient = createClient({ url: `file:${testDbPath}` });
    const competingWrite = await competingClient.execute({
      sql: `UPDATE terminal_session
        SET agent_activity_status = 'running', agent_activity_order = 200
        WHERE id = 'status-race'`,
      args: [],
    }).then(
      () => null,
      (error: unknown) => error as { code?: string },
    );
    expect(competingWrite).toMatchObject({ code: "SQLITE_BUSY" });
    competingClient.close();

    releaseLock();
    const stored = await notificationPromise;
    await rawClient.execute({
      sql: `UPDATE terminal_session
        SET agent_activity_status = 'running', agent_activity_order = 200
        WHERE id = 'status-race'`,
      args: [],
    });
    expect(stored.current).toBe(true);
    expect(stored.notification).toMatchObject({ type: "agent_waiting" });
    const current = await rawClient.execute(
      "SELECT agent_activity_status, agent_activity_order FROM terminal_session WHERE id = 'status-race'",
    );
    expect(current.rows[0]).toMatchObject({
      agent_activity_status: "running",
      agent_activity_order: 200,
    });
  });

  it("prunes lifecycle receipts only after the documented retention horizon", async () => {
    const svc = await loadService();
    const now = new Date("2026-08-03T12:00:00Z");
    const old = now.getTime() - svc.LIFECYCLE_RECEIPT_RETENTION_MS - 1;
    const recent = now.getTime() - svc.LIFECYCLE_RECEIPT_RETENTION_MS + 1;
    await rawClient.batch([
      { sql: "INSERT INTO notification_delivery (id, user_id, created_at) VALUES (?, ?, ?)", args: ["old-n", "u1", old] },
      { sql: "INSERT INTO notification_delivery (id, user_id, created_at) VALUES (?, ?, ?)", args: ["new-n", "u1", recent] },
      { sql: "INSERT INTO agent_status_delivery (id, user_id, session_id, generation, delivery_id, status, status_at, arrival_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["old-s", "u1", "s1", 0, "old", "running", old, old, old] },
      { sql: "INSERT INTO agent_status_delivery (id, user_id, session_id, generation, delivery_id, status, status_at, arrival_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["new-s", "u1", "s1", 0, "new", "running", recent, recent, recent] },
    ], "write");

    await svc.pruneLifecycleDeliveryReceipts(now);

    const notifications = await rawClient.execute("SELECT id FROM notification_delivery ORDER BY id");
    const statuses = await rawClient.execute("SELECT id FROM agent_status_delivery ORDER BY id");
    expect(notifications.rows.map((row) => row.id)).toEqual(["new-n"]);
    expect(statuses.rows.map((row) => row.id)).toEqual(["new-s"]);
  });
});
