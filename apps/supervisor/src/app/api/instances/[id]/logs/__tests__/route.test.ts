import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for GET /api/instances/:id/logs (viewer + owner). Read-only k8s; must
 * degrade to 200 (empty + note) when no cluster is reachable, never 500.
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

interface PodLogsResult {
  pod: string | null;
  logs: string;
}
const svc: {
  clientsThrow: boolean;
  getPodLogs: () => Promise<PodLogsResult>;
} = {
  clientsThrow: false,
  getPodLogs: vi.fn(async () => ({ pod: "rdv-0", logs: "hello\n" })),
};
vi.mock("@/lib/provisioner-service", () => ({
  defaultClients: () => {
    if (svc.clientsThrow) throw new Error("Kubernetes config unavailable");
    return {};
  },
  getPodLogs: (...args: unknown[]) => svc.getPodLogs(...(args as [])),
}));

import { GET } from "@/app/api/instances/[id]/logs/route";

function req(id: string, qs = ""): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/instances/${id}/logs${qs}`),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  dbState.row = { id: "inst-1", slug: "alpha", ownerId: "v-1", status: "ready" };
  svc.clientsThrow = false;
  svc.getPodLogs = vi.fn(async () => ({ pod: "rdv-0", logs: "hello\n" }));
  authState.user = { id: "v-1", email: "v@example.com", role: "viewer" };
});

describe("GET /api/instances/:id/logs", () => {
  it("returns { pod, container:'rdv', logs } on success", async () => {
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ pod: "rdv-0", container: "rdv", logs: "hello\n" });
  });

  it("clamps ?tail above the max and passes previous through", async () => {
    await GET(...req("inst-1", "?tail=99999&previous=true"));
    expect(svc.getPodLogs).toHaveBeenCalledWith(
      "alpha",
      { tailLines: 2000, previous: true },
      expect.anything(),
    );
  });

  it("no pod → { pod:null, logs:'' }", async () => {
    svc.getPodLogs = vi.fn(async () => ({ pod: null, logs: "" }));
    const res = await GET(...req("inst-1"));
    const data = await res.json();
    expect(data.pod).toBeNull();
    expect(data.logs).toBe("");
  });

  it("no cluster → 200 empty + note (never 500)", async () => {
    svc.clientsThrow = true;
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.note).toBe("k8s unavailable");
    expect(data.logs).toBe("");
  });

  it("live read failure → 200 empty + note (never 500)", async () => {
    svc.getPodLogs = vi.fn(async () => {
      throw new Error("API error");
    });
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).note).toBe("could not read pod logs");
  });

  it("non-owner viewer → 404", async () => {
    authState.user = { id: "other", email: "o@example.com", role: "viewer" };
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(404);
  });
});
