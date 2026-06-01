import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for PATCH /api/instances/:id (operator + owner). Records desired spec
 * (displayName / imageTag / storageRequest) + audit rows and returns 202; the
 * reconciler actuates image rollout + grow-only resize. parseQuantityToBytes is
 * the REAL pure helper (imported transitively) — no cluster contact.
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

import { PATCH } from "@/app/api/instances/[id]/route";

function patchReq(
  id: string,
  body: unknown,
): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/instances/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  dbState.row = {
    id: "inst-1",
    slug: "alpha",
    ownerId: "op-1",
    status: "ready",
    displayName: "Alpha",
    imageTag: "ghcr.io/x@sha256:old",
    storageRequest: "10Gi",
  };
  updates.length = 0;
  inserts.length = 0;
});

describe("PATCH /api/instances/:id", () => {
  it("rename: displayName → 202, DB updated, audit rename", async () => {
    const res = await PATCH(...patchReq("inst-1", { displayName: "Renamed" }));
    expect(res.status).toBe(202);
    expect(updates[0]?.displayName).toBe("Renamed");
    expect(inserts.some((i) => i.action === "rename")).toBe(true);
  });

  it("imageTag → 202, desired image stored, audit image:request", async () => {
    const res = await PATCH(...patchReq("inst-1", { imageTag: "ghcr.io/x@sha256:new" }));
    expect(res.status).toBe(202);
    expect(updates[0]?.imageTag).toBe("ghcr.io/x@sha256:new");
    expect(inserts.some((i) => i.action === "image:request")).toBe(true);
  });

  it("storageRequest grow (20Gi > 10Gi) → 202, audit resize:request", async () => {
    const res = await PATCH(...patchReq("inst-1", { storageRequest: "20Gi" }));
    expect(res.status).toBe(202);
    expect(updates[0]?.storageRequest).toBe("20Gi");
    expect(inserts.some((i) => i.action === "resize:request")).toBe(true);
  });

  it("storageRequest shrink (5Gi < 10Gi) → 400 INVALID_RESIZE", async () => {
    const res = await PATCH(...patchReq("inst-1", { storageRequest: "5Gi" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_RESIZE");
    expect(updates.length).toBe(0);
  });

  it("storageRequest equal (10Gi == 10Gi) → 400 INVALID_RESIZE", async () => {
    const res = await PATCH(...patchReq("inst-1", { storageRequest: "10Gi" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_RESIZE");
  });

  it("unparseable storageRequest → 400 INVALID_BODY", async () => {
    const res = await PATCH(...patchReq("inst-1", { storageRequest: "lots" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_BODY");
  });

  it("zero storageRequest (0Gi) → 400 INVALID_BODY (rejected as not a valid size)", async () => {
    const res = await PATCH(...patchReq("inst-1", { storageRequest: "0Gi" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_BODY");
    expect(updates.length).toBe(0);
  });

  it("no fields → 400 INVALID_BODY", async () => {
    const res = await PATCH(...patchReq("inst-1", {}));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_BODY");
    expect(updates.length).toBe(0);
  });

  it("bad state (provisioning) → 409 INVALID_STATE", async () => {
    dbState.row = { ...(dbState.row as object), status: "provisioning" };
    const res = await PATCH(...patchReq("inst-1", { displayName: "X" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("INVALID_STATE");
  });

  it("suspended instance is editable → 202", async () => {
    dbState.row = { ...(dbState.row as object), status: "suspended" };
    const res = await PATCH(...patchReq("inst-1", { imageTag: "ghcr.io/x@sha256:new" }));
    expect(res.status).toBe(202);
  });

  it("non-owner operator → 404 (not 403)", async () => {
    authState.user = { id: "other-op", email: "other@example.com", role: "operator" };
    const res = await PATCH(...patchReq("inst-1", { displayName: "X" }));
    expect(res.status).toBe(404);
    authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
  });

  it("multiple fields in one PATCH → one update, multiple audit rows", async () => {
    const res = await PATCH(
      ...patchReq("inst-1", { displayName: "New", storageRequest: "30Gi" }),
    );
    expect(res.status).toBe(202);
    expect(updates.length).toBe(1);
    expect(updates[0]?.displayName).toBe("New");
    expect(updates[0]?.storageRequest).toBe("30Gi");
    expect(inserts.filter((i) => i.action === "rename" || i.action === "resize:request").length).toBe(2);
  });
});
