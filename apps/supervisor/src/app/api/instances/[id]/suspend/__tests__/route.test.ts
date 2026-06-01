import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for POST /api/instances/:id/suspend (operator). Single-writer model:
 * the route only records `ready → suspended` (+ suspendedAt) + an audit row and
 * returns 202; the reconciler does the actual scale-to-0.
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

import { POST } from "@/app/api/instances/[id]/suspend/route";

function req(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/instances/${id}/suspend`, { method: "POST" }),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "ready" };
  updates.length = 0;
  inserts.length = 0;
});

describe("POST /api/instances/:id/suspend", () => {
  it("ready → 202, row marked suspended + suspendedAt, audit row written", async () => {
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(202);
    expect(updates[0]?.status).toBe("suspended");
    expect(updates[0]?.suspendedAt).toBeInstanceOf(Date);
    expect(inserts.some((i) => i.action === "suspend")).toBe(true);
  });

  it("already suspended → idempotent 202, no new write", async () => {
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "suspended" };
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(202);
    expect(updates.length).toBe(0);
  });

  it("provisioning → 409 INVALID_STATE", async () => {
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "provisioning" };
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("INVALID_STATE");
    expect(updates.length).toBe(0);
  });

  it("non-owner operator → 404 (not 403)", async () => {
    authState.user = { id: "other-op", email: "other@example.com", role: "operator" };
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
    authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
  });

  it("missing instance → 404", async () => {
    dbState.row = undefined;
    const res = await POST(...req("missing"));
    expect(res.status).toBe(404);
  });

  it("viewer → 403 (role gate)", async () => {
    authState.user = { id: "v-1", email: "v@example.com", role: "viewer" };
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(403);
    authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
  });
});
