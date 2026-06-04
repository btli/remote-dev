import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for POST /api/instances/:id/agent (epic remote-dev-oyej.10): operator
 * gate, owner-scope 404, and dispatch wiring (the shared dispatchAgentRun is
 * mocked so we test the route's auth + lookup, not the proxy).
 */
const authState: { user: { id: string; email: string; role: Role } } = {
  user: { id: "op-1", email: "op@example.com", role: "operator" },
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

const dispatchMock = vi.fn(async () =>
  Response.json({ id: "run-1", status: "running" }, { status: 202 }),
);
vi.mock("@/lib/agent-dispatch", () => ({
  dispatchAgentRun: (...args: unknown[]) => dispatchMock(...(args as [])),
}));

import { POST } from "@/app/api/instances/[id]/agent/route";

function req(
  id: string,
  body: unknown,
): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/instances/${id}/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

const goodBody = { projectId: "p1", prompt: "do it" };

beforeEach(() => {
  authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
  dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "ready" };
  dispatchMock.mockClear();
});

describe("POST /api/instances/:id/agent", () => {
  it("operator owner → dispatches (202)", async () => {
    const res = await POST(...req("inst-1", goodBody));
    expect(res.status).toBe(202);
    expect(dispatchMock).toHaveBeenCalledOnce();
    const [user, row, body] = dispatchMock.mock.calls[0] as unknown[];
    expect((user as { id: string }).id).toBe("op-1");
    expect((row as { slug: string }).slug).toBe("alpha");
    expect(body).toMatchObject({ projectId: "p1", prompt: "do it" });
  });

  it("viewer → 403 (role gate)", async () => {
    authState.user = { id: "v-1", email: "v@example.com", role: "viewer" };
    const res = await POST(...req("inst-1", goodBody));
    expect(res.status).toBe(403);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("non-owner operator → 404 (owner-scope, not 403)", async () => {
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "someone-else", status: "ready" };
    const res = await POST(...req("inst-1", goodBody));
    expect(res.status).toBe(404);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("missing instance → 404", async () => {
    dbState.row = undefined;
    const res = await POST(...req("inst-x", goodBody));
    expect(res.status).toBe(404);
  });

  it("missing projectId/prompt → 400", async () => {
    const res = await POST(...req("inst-1", { projectId: "p1" }));
    expect(res.status).toBe(400);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
