// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  pending: [] as Array<Record<string, unknown>>,
  sessions: new Map<string, Record<string, unknown>>(),
  processed: [] as Array<Record<string, unknown>>,
  createNotificationForAgentStatus: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      agentStatusDeliveries: {
        findMany: vi.fn(async () => hoisted.pending),
      },
      terminalSessions: {
        findFirst: vi.fn(async (args: unknown) => {
          const serialized = JSON.stringify(args);
          for (const [sessionId, session] of hoisted.sessions) {
            if (serialized.includes(sessionId)) return session;
          }
          return null;
        }),
      },
    },
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          hoisted.processed.push(values);
        }),
      }),
    })),
  },
}));

vi.mock("@/db/schema", () => ({
  agentStatusDeliveries: new Proxy(
    { _table: "agentStatusDeliveries" },
    { get: (target, prop) => prop in target ? target[prop as keyof typeof target] : String(prop) },
  ),
  terminalSessions: new Proxy(
    { _table: "terminalSessions" },
    { get: (target, prop) => prop in target ? target[prop as keyof typeof target] : String(prop) },
  ),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  isNull: (value: unknown) => ({ isNull: value }),
}));

vi.mock("@/services/notification-service", () => ({
  createNotificationForAgentStatus: hoisted.createNotificationForAgentStatus,
}));

beforeEach(() => {
  hoisted.pending = [];
  hoisted.sessions.clear();
  hoisted.processed = [];
  hoisted.createNotificationForAgentStatus.mockReset();
  hoisted.createNotificationForAgentStatus.mockResolvedValue({
    current: true,
    notification: { id: "notification-1" },
  });
});

describe("durable agent-status notification delivery", () => {
  it("repairs an old applied receipt whose callback crashed before notification storage", async () => {
    const now = new Date("2026-08-03T20:00:00.000Z");
    hoisted.pending = [{
      id: "receipt-1",
      userId: "user-1",
      sessionId: "session-1",
      generation: 4,
      status: "waiting",
      createdAt: new Date(now.getTime() - 60_000),
    }];
    hoisted.sessions.set("session-1", {
      id: "session-1",
      userId: "user-1",
      name: "Review agent",
      agentProvider: "codex",
    });

    const { reconcileAgentStatusNotifications } = await import(
      "../agent-status-notification-service"
    );
    await expect(reconcileAgentStatusNotifications(now)).resolves.toBe(1);

    expect(hoisted.createNotificationForAgentStatus).toHaveBeenCalledWith(
      "receipt-1",
      expect.objectContaining({
        userId: "user-1",
        sessionId: "session-1",
        sessionName: "Review agent",
        type: "agent_waiting",
        focused: false,
      }),
    );
    expect(hoisted.processed).toEqual([
      { notificationProcessedAt: now },
    ]);
  });

  it("leaves fresh intent to the focus-aware callback during its retry window", async () => {
    const now = new Date("2026-08-03T20:00:00.000Z");
    hoisted.pending = [{
      id: "receipt-fresh",
      userId: "user-1",
      sessionId: "session-1",
      generation: 0,
      status: "waiting",
      createdAt: new Date(now.getTime() - 1_000),
    }];
    hoisted.sessions.set("session-1", {
      id: "session-1",
      userId: "user-1",
      name: "Fresh agent",
      agentProvider: "codex",
    });

    const { reconcileAgentStatusNotifications } = await import(
      "../agent-status-notification-service"
    );
    await expect(reconcileAgentStatusNotifications(now)).resolves.toBe(0);
    expect(hoisted.createNotificationForAgentStatus).not.toHaveBeenCalled();
    expect(hoisted.processed).toEqual([]);
  });

  it("keeps failed repair intent pending for the next sweep", async () => {
    const now = new Date("2026-08-03T20:00:00.000Z");
    hoisted.pending = [{
      id: "receipt-retry",
      userId: "user-1",
      sessionId: "session-1",
      generation: 0,
      status: "error",
      createdAt: new Date(now.getTime() - 60_000),
    }];
    hoisted.sessions.set("session-1", {
      id: "session-1",
      userId: "user-1",
      name: "Broken agent",
      agentProvider: "codex",
    });
    hoisted.createNotificationForAgentStatus.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    const { reconcileAgentStatusNotifications } = await import(
      "../agent-status-notification-service"
    );
    await expect(reconcileAgentStatusNotifications(now)).resolves.toBe(0);
    expect(hoisted.processed).toEqual([]);
  });
});
