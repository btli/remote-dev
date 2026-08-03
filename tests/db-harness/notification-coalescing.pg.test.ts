import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

describe("notification lifecycle coalescing on PostgreSQL", () => {
  let admin: Pool;
  const userId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  beforeAll(async () => {
    const url = process.env.TEST_PG_URL;
    if (!url) throw new Error("TEST_PG_URL is required");
    process.env.DATABASE_URL = url;
    admin = new Pool({ connectionString: url });
    await admin.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`,
      [userId, "Notification race", `${userId}@example.test`],
    );
    await admin.query(
      `INSERT INTO project (id, user_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [projectId, userId, "Notification race"],
    );
    await admin.query(
      `INSERT INTO terminal_session
         (id, user_id, project_id, name, tmux_session_name,
          last_activity_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())`,
      [sessionId, userId, projectId, "Notification race", `rdv-${sessionId}`],
    );
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
      await admin.end();
    }
  });

  it("serializes concurrent first deliveries from independent service instances", async () => {
    // Resetting the graph creates two process-local coalescing queues and two
    // pools. Only the transaction-scoped PostgreSQL advisory lock is shared.
    vi.resetModules();
    const firstService = await import("@/services/notification-service");
    vi.resetModules();
    const secondService = await import("@/services/notification-service");

    const base = {
      userId,
      sessionId,
      sessionName: "Notification race",
      type: "agent_waiting" as const,
      title: "Agent needs attention",
      focused: true,
    };

    await Promise.all([
      firstService.createNotification({ ...base, idempotencyKey: "pg-race-a" }),
      secondService.createNotification({ ...base, idempotencyKey: "pg-race-b" }),
    ]);

    const events = await admin.query<{ count: number }>(
      `SELECT count FROM notification_event
       WHERE user_id = $1 AND session_id = $2 AND coalesce_key = 'agent_lifecycle'`,
      [userId, sessionId],
    );
    const receipts = await admin.query<{ total: string }>(
      `SELECT count(*) AS total FROM notification_delivery WHERE user_id = $1`,
      [userId],
    );

    expect(events.rows).toEqual([{ count: 2 }]);
    expect(Number(receipts.rows[0]?.total)).toBe(2);
  });

  it("holds the session row through status notification materialization", async () => {
    const receiptId = `status-receipt-${crypto.randomUUID()}`;
    await admin.query(
      `UPDATE terminal_session
       SET agent_restart_count = 3,
           agent_activity_status = 'waiting',
           agent_activity_order = 100
       WHERE id = $1`,
      [sessionId],
    );
    await admin.query(
      `INSERT INTO agent_status_delivery
         (id, user_id, session_id, generation, delivery_id, status,
          status_at, arrival_order, applied, created_at)
       VALUES ($1, $2, $3, 3, $4, 'waiting', 100, 100, TRUE, NOW())`,
      [receiptId, userId, sessionId, crypto.randomUUID()],
    );

    vi.resetModules();
    const service = await import("@/services/notification-service");
    let release!: () => void;
    let reportLocked!: () => void;
    const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const storing = service.createNotificationForAgentStatus(
      receiptId,
      {
        userId,
        sessionId,
        type: "agent_waiting",
        title: "Agent needs attention",
      },
      { afterStatusLock: async () => { reportLocked(); await gate; } },
    );
    await locked;

    let newerCommitted = false;
    const newer = admin.query(
      `UPDATE terminal_session
       SET agent_activity_status = 'running', agent_activity_order = 200
       WHERE id = $1`,
      [sessionId],
    ).then(() => { newerCommitted = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(newerCommitted).toBe(false);

    release();
    const stored = await storing;
    await newer;
    expect(stored).toMatchObject({ current: true });
    expect(stored.notification).not.toBeNull();
    expect(newerCommitted).toBe(true);
  });

  it("merges legacy cross-group enrichment into one failure aggregate", async () => {
    vi.resetModules();
    const service = await import("@/services/notification-service");
    const heuristicKey = `pg-heuristic-${crypto.randomUUID()}`;
    const heuristic = await service.createNotification({
      userId,
      sessionId,
      type: "agent_stuck",
      title: "Agent stopped responding",
      idempotencyKey: heuristicKey,
    });
    expect(heuristic).not.toBeNull();
    await admin.query(
      `UPDATE notification_event SET coalesce_key = 'agent_lifecycle' WHERE id = $1`,
      [heuristic!.id],
    );
    const destination = await service.createNotification({
      userId,
      sessionId,
      type: "agent_error",
      title: "Earlier failure",
      idempotencyKey: `pg-failure-${crypto.randomUUID()}`,
    });
    expect(destination).not.toBeNull();

    const enriched = await service.replaceIdempotentNotification({
      userId,
      sessionId,
      type: "agent_error",
      title: "Agent exited with code 9",
      idempotencyKey: heuristicKey,
    });
    expect(enriched).toMatchObject({ id: destination!.id, count: 2 });

    const rows = await admin.query<{ id: string; count: number }>(
      `SELECT id, count FROM notification_event
       WHERE user_id = $1 AND session_id = $2
         AND coalesce_key = 'agent_failure' AND read_at IS NULL`,
      [userId, sessionId],
    );
    expect(rows.rows).toEqual([{ id: destination!.id, count: 2 }]);
    const pointers = await admin.query<{ notification_id: string }>(
      `SELECT DISTINCT notification_id FROM notification_delivery
       WHERE notification_id = ANY($1::text[])`,
      [[heuristic!.id, destination!.id]],
    );
    expect(pointers.rows).toEqual([{ notification_id: destination!.id }]);
  });
});
