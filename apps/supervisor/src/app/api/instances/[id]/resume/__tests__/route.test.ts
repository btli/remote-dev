import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for POST /api/instances/:id/resume (operator). Symmetric to suspend:
 * records `suspended → ready` (+ clears suspendedAt) + an audit row, 202; the
 * reconciler does the actual scale-to-1.
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
const updates: Record<string, unknown>[] = [];
const inserts: Record<string, unknown>[] = [];

vi.mock("@/db", () => ({
  db: {
    query: { instance: { findFirst: async () => dbState.row } },
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updates.push(set);
            return [{ ...dbState.row, ...set }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return Promise.resolve(undefined);
      },
    }),
  },
}));

import { POST } from "@/app/api/instances/[id]/resume/route";

function req(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/instances/${id}/resume`, { method: "POST" }),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "suspended" };
  updates.length = 0;
  inserts.length = 0;
});

describe("POST /api/instances/:id/resume", () => {
  it("suspended → 202, row marked ready + suspendedAt cleared, audit row written", async () => {
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(202);
    expect(updates[0]?.status).toBe("ready");
    expect(updates[0]?.suspendedAt).toBeNull();
    expect(inserts.some((i) => i.action === "resume")).toBe(true);
  });

  it("already ready → idempotent 202, no new write", async () => {
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "ready" };
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(202);
    expect(updates.length).toBe(0);
  });

  it("terminating → 409 INVALID_STATE (canTransition(terminating, ready) is false)", async () => {
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "terminating" };
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("INVALID_STATE");
  });

  it("non-owner operator → 404 (not 403)", async () => {
    authState.user = { id: "other-op", email: "other@example.com", role: "operator" };
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(404);
    authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
  });
});
