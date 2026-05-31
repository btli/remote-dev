import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for DELETE /api/instances/:id. Focus: Fix 5 — delete is ADMIN-only.
 * An operator who OWNS the instance must now get 403; an admin succeeds (202).
 */

const authState: { user: { id: string; email: string; role: Role } } = {
  user: { id: "admin-1", email: "admin@example.com", role: "admin" },
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
  phase1Pending: () => Response.json({ code: "PHASE1_PENDING" }, { status: 501 }),
}));

const dbState: { row: Record<string, unknown> | undefined } = { row: undefined };
const updates: Record<string, unknown>[] = [];

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
    insert: () => ({ values: () => Promise.resolve(undefined) }),
  },
}));

import { DELETE } from "@/app/api/instances/[id]/route";

function delReq(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/instances/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  dbState.row = {
    id: "inst-1",
    slug: "alpha",
    ownerId: "op-1",
    status: "ready",
  };
  updates.length = 0;
});

describe("DELETE /api/instances/:id — admin-only (Fix 5)", () => {
  it("an operator who OWNS the instance is now FORBIDDEN (403)", async () => {
    authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
    const res = await DELETE(...delReq("inst-1"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
    expect(updates.length).toBe(0);
  });

  it("an admin can terminate → 202, row marked terminating", async () => {
    authState.user = { id: "admin-1", email: "admin@example.com", role: "admin" };
    const res = await DELETE(...delReq("inst-1"));
    expect(res.status).toBe(202);
    expect(updates[0]?.status).toBe("terminating");
  });

  it("admin gets 404 for a non-existent instance", async () => {
    authState.user = { id: "admin-1", email: "admin@example.com", role: "admin" };
    dbState.row = undefined;
    const res = await DELETE(...delReq("missing"));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("admin delete is idempotent on an already-terminating instance (202, no new write)", async () => {
    authState.user = { id: "admin-1", email: "admin@example.com", role: "admin" };
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "terminating" };
    const res = await DELETE(...delReq("inst-1"));
    expect(res.status).toBe(202);
    expect(updates.length).toBe(0); // no transition write
  });
});
