import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for GET /api/instances/:id/events (viewer + owner). Read-only k8s; must
 * degrade to 200 `{ events: [] }` (+ note) when no cluster is reachable.
 */

const authState: { user: { id: string; email: string; role: Role } } = {
  user: { id: "v-1", email: "v@example.com", role: "viewer" },
};
const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

vi.mock("@/lib/auth", () => ({
  withSupervisorAuth:
    (required: Role, handler: (req: Request, ctx: unknown) => unknown) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => {
      if (RANK[authState.user.role] < RANK[required]) {
        return Response.json({ code: "FORBIDDEN" }, { status: 403 });
      }
      const params = ctx?.params ? await ctx.params : undefined;
      return handler(req, { user: authState.user, params });
    },
}));

const dbState: { row: Record<string, unknown> | undefined } = { row: undefined };
vi.mock("@/db", () => ({
  db: { query: { instance: { findFirst: async () => dbState.row } } },
}));

const svc = {
  clientsThrow: false,
  listInstanceEvents: vi.fn(async () => [
    {
      type: "Warning",
      reason: "BackOff",
      message: "x",
      count: 2,
      lastSeen: "2026-05-31T00:00:00.000Z",
      involvedObject: "Pod/rdv-0",
    },
  ]),
};
vi.mock("@/lib/provisioner-service", () => ({
  defaultClients: () => {
    if (svc.clientsThrow) throw new Error("Kubernetes config unavailable");
    return {};
  },
  listInstanceEvents: (...args: unknown[]) => svc.listInstanceEvents(...(args as [])),
}));

import { GET } from "@/app/api/instances/[id]/events/route";

function req(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/instances/${id}/events`),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  dbState.row = { id: "inst-1", slug: "alpha", ownerId: "v-1", status: "ready" };
  svc.clientsThrow = false;
  svc.listInstanceEvents = vi.fn(async () => [
    {
      type: "Warning",
      reason: "BackOff",
      message: "x",
      count: 2,
      lastSeen: "2026-05-31T00:00:00.000Z",
      involvedObject: "Pod/rdv-0",
    },
  ]);
  authState.user = { id: "v-1", email: "v@example.com", role: "viewer" };
});

describe("GET /api/instances/:id/events", () => {
  it("returns { events } on success", async () => {
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].reason).toBe("BackOff");
  });

  it("empty events → 200 { events: [] }", async () => {
    svc.listInstanceEvents = vi.fn(async () => []);
    const res = await GET(...req("inst-1"));
    expect((await res.json()).events).toEqual([]);
  });

  it("no cluster → 200 { events: [] } + note (never 500)", async () => {
    svc.clientsThrow = true;
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toEqual([]);
    expect(data.note).toBe("k8s unavailable");
  });

  it("live read failure → 200 empty + note", async () => {
    svc.listInstanceEvents = vi.fn(async () => {
      throw new Error("API error");
    });
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).note).toBe("could not read events");
  });

  it("non-owner viewer → 404", async () => {
    authState.user = { id: "other", email: "o@example.com", role: "viewer" };
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(404);
  });
});
