import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for POST /api/instances. Focus: Fix 4 — a non-UNIQUE insert error must
 * surface as a 500 (not be masked as SLUG_TAKEN). We mock the auth wrapper to a
 * pass-through operator and drive @/db's insert to fail in different ways.
 */

// --- Auth mock: faithful role gate over a configurable test user ------------
const authState: { user: { id: string; email: string; role: Role } } = {
  user: { id: "op-1", email: "op@example.com", role: "operator" },
};
const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

// Mirrors the real withSupervisorAuth: role gate + a try/catch that converts a
// thrown handler error into a 500 (so Fix 4's rethrow surfaces as 500, not 409).
vi.mock("@/lib/auth", () => ({
  withSupervisorAuth:
    (required: Role, handler: (req: Request, ctx: unknown) => unknown) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => {
      if (RANK[authState.user.role] < RANK[required]) {
        return Response.json({ code: "FORBIDDEN" }, { status: 403 });
      }
      try {
        const params = ctx?.params ? await ctx.params : undefined;
        return await handler(req, { user: authState.user, params });
      } catch {
        return Response.json({ code: "INTERNAL_ERROR" }, { status: 500 });
      }
    },
  phase1Pending: () => Response.json({ code: "PHASE1_PENDING" }, { status: 501 }),
}));

// --- DB mock ----------------------------------------------------------------
const dbState: {
  existing: unknown;
  insertError: Error | null;
} = { existing: undefined, insertError: null };

const auditInserts: Record<string, unknown>[] = [];

vi.mock("@/db", () => ({
  db: {
    query: {
      instance: { findFirst: async () => dbState.existing },
    },
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        // instance insert returns a row (or throws); seed/audit inserts resolve.
        const isInstance =
          "slug" in vals && "namespace" in vals && "ownerId" in vals;
        if (isInstance) {
          return {
            returning: async () => {
              if (dbState.insertError) throw dbState.insertError;
              return [{ id: "new-id", namespace: vals.namespace, ...vals }];
            },
          };
        }
        // audit / seed
        auditInserts.push(vals);
        return Promise.resolve(undefined);
      },
    }),
  },
}));

// resolveDefaultStorageTarget needs no cluster; import real module.
import { POST } from "@/app/api/instances/route";

function postReq(body: unknown): Request {
  return new Request("https://sup.example.com/api/instances", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
  dbState.existing = undefined;
  dbState.insertError = null;
  auditInserts.length = 0;
});

describe("POST /api/instances — success", () => {
  it("inserts a requested row and returns 202", async () => {
    const res = await POST(postReq({ slug: "alpha", displayName: "Alpha" }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.instance.namespace).toBe("rdv-alpha");
  });
});

describe("POST /api/instances — validation", () => {
  it("400 on invalid slug", async () => {
    const res = await POST(postReq({ slug: "Bad_Slug", displayName: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_SLUG");
  });

  it("409 SLUG_TAKEN when slug already exists (pre-check)", async () => {
    dbState.existing = { id: "x", slug: "alpha" };
    const res = await POST(postReq({ slug: "alpha", displayName: "Alpha" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("SLUG_TAKEN");
  });
});

describe("POST /api/instances — storage target (jvcx.5)", () => {
  it("default (no storageTargetId) snapshots the cluster-default config onto the row", async () => {
    const res = await POST(postReq({ slug: "alpha", displayName: "Alpha" }));
    expect(res.status).toBe(202);
    const body = await res.json();
    const snap = JSON.parse(body.instance.storageConfigSnapshot);
    expect(snap).toMatchObject({ kind: "storage-class", isDefault: true });
    expect(body.instance.storageTargetId).toBeNull();
  });

  it("a chosen node:<host> id is resolved + snapshotted (local-path, pinned)", async () => {
    const res = await POST(
      postReq({
        slug: "beta",
        displayName: "Beta",
        storageTargetId: "node:worker-1",
      }),
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.instance.storageTargetId).toBe("node:worker-1");
    const snap = JSON.parse(body.instance.storageConfigSnapshot);
    expect(snap).toMatchObject({
      kind: "local-path",
      storageClassName: "local-path",
      nodeHostname: "worker-1",
    });
  });

  it("a bad/unknown storageTargetId → 400 INVALID_STORAGE_TARGET", async () => {
    const res = await POST(
      postReq({
        slug: "gamma",
        displayName: "Gamma",
        storageTargetId: "bogus:x",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_STORAGE_TARGET");
  });
});

describe("POST /api/instances — insert error handling (Fix 4)", () => {
  it("409 SLUG_TAKEN when the insert hits a UNIQUE violation", async () => {
    dbState.insertError = new Error(
      "SQLITE_CONSTRAINT: UNIQUE constraint failed: instance.slug",
    );
    const res = await POST(postReq({ slug: "alpha", displayName: "Alpha" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("SLUG_TAKEN");
  });

  it("does NOT mask a non-UNIQUE DB error as SLUG_TAKEN → 500", async () => {
    dbState.insertError = new Error("SQLITE_IOERR: disk I/O error");
    // The route rethrows; withSupervisorAuth's try/catch converts it to a 500.
    const res = await POST(postReq({ slug: "alpha", displayName: "Alpha" }));
    expect(res.status).toBe(500);
    expect((await res.json()).code).not.toBe("SLUG_TAKEN");
  });
});
