import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for POST /api/instances/:id/stop — an exact behavioral alias of
 * /suspend. Same operator role, same owner-scoping, SAME canonical audit action
 * "suspend" / status `suspended`.
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

import { POST } from "@/app/api/instances/[id]/stop/route";

function req(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/instances/${id}/stop`, { method: "POST" }),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "ready" };
  updates.length = 0;
  inserts.length = 0;
  authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
});

describe("POST /api/instances/:id/stop (alias of suspend)", () => {
  it("ready → 202, marked suspended, canonical audit action 'suspend'", async () => {
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(202);
    expect(updates[0]?.status).toBe("suspended");
    expect(inserts.some((i) => i.action === "suspend")).toBe(true);
  });

  it("non-owner operator → 404 (not 403)", async () => {
    authState.user = { id: "other", email: "o@example.com", role: "operator" };
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(404);
  });

  it("viewer → 403 (role gate)", async () => {
    authState.user = { id: "v", email: "v@example.com", role: "viewer" };
    const res = await POST(...req("inst-1"));
    expect(res.status).toBe(403);
  });
});
