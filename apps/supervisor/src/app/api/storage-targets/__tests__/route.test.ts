import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for /api/storage-targets:
 *   GET    (viewer) → returns discovered options.
 *   POST   (admin)  → registers a target; operator forbidden; dup name → 409.
 *   DELETE (admin)  → rejects non-`reg:` ids (400); deletes a reg row.
 *
 * Auth is mocked to a faithful role gate over a configurable user (mirrors the
 * instances route tests).
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
      try {
        const params = ctx?.params ? await ctx.params : undefined;
        return await handler(req, { user: authState.user, params });
      } catch {
        return Response.json({ code: "INTERNAL_ERROR" }, { status: 500 });
      }
    },
  phase1Pending: () => Response.json({ code: "PHASE1_PENDING" }, { status: 501 }),
}));

// discoverStorageTargets is mocked so GET doesn't touch a cluster/db.
vi.mock("@/lib/storage", () => ({
  discoverStorageTargets: vi.fn(async () => [
    { id: "default", name: "Cluster default", kind: "storage-class", resiliencyNote: "x", isDefault: true },
    { id: "node:worker-1", name: "Local path on node: worker-1", kind: "local-path", resiliencyNote: "node-pinned", isDefault: false },
  ]),
}));

// DB mock: insert returns a row or throws; delete records; findFirst returns row.
const dbState: {
  insertError: Error | null;
  regRow: Record<string, unknown> | undefined;
} = { insertError: null, regRow: undefined };
const deletes: unknown[] = [];

vi.mock("@/db", () => ({
  db: {
    query: {
      registeredStorageTarget: { findFirst: async () => dbState.regRow },
    },
    insert: () => ({
      values: (vals: Record<string, unknown>) => ({
        returning: async () => {
          if (dbState.insertError) throw dbState.insertError;
          return [{ id: "reg-uuid", ...vals }];
        },
      }),
    }),
    delete: () => ({
      where: (w: unknown) => {
        deletes.push(w);
        return Promise.resolve(undefined);
      },
    }),
  },
}));

import { GET, POST } from "@/app/api/storage-targets/route";
import { DELETE } from "@/app/api/storage-targets/[id]/route";

function postReq(body: unknown): Request {
  return new Request("https://sup.example.com/api/storage-targets", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function delReq(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/storage-targets/${id}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  authState.user = { id: "admin-1", email: "admin@example.com", role: "admin" };
  dbState.insertError = null;
  dbState.regRow = { id: "reg-uuid", name: "office-nfs" };
  deletes.length = 0;
});

describe("GET /api/storage-targets", () => {
  it("returns the discovered options (viewer)", async () => {
    authState.user = { id: "v", email: "v@example.com", role: "viewer" };
    const res = await GET(new Request("https://sup.example.com/api/storage-targets"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targets[0].id).toBe("default");
    expect(body.targets.some((t: { id: string }) => t.id === "node:worker-1")).toBe(true);
  });
});

describe("POST /api/storage-targets", () => {
  it("registers an NFS target → 201 (admin)", async () => {
    const res = await POST(
      postReq({
        name: "office-nfs",
        kind: "nfs",
        config: { storageClassName: "nfs-client" },
        resiliencyNote: "Off-cluster NFS",
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.target.name).toBe("office-nfs");
  });

  it("operator is forbidden (admin-only) → 403", async () => {
    authState.user = { id: "op", email: "op@example.com", role: "operator" };
    const res = await POST(
      postReq({ name: "x", kind: "nfs", config: {} }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an invalid kind → 400", async () => {
    const res = await POST(postReq({ name: "x", kind: "bogus", config: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_BODY");
  });

  it("rejects a non-object config → 400", async () => {
    const res = await POST(postReq({ name: "x", kind: "nfs", config: "nope" }));
    expect(res.status).toBe(400);
  });

  it("rejects an NFS target with no config.storageClassName → 400 INVALID_CONFIG", async () => {
    const res = await POST(postReq({ name: "x", kind: "nfs", config: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_CONFIG");
  });

  it("rejects an NFS target with a blank config.storageClassName → 400 INVALID_CONFIG", async () => {
    const res = await POST(
      postReq({ name: "x", kind: "nfs", config: { storageClassName: "  " } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_CONFIG");
  });

  it("duplicate name → 409", async () => {
    dbState.insertError = new Error(
      "SQLITE_CONSTRAINT: UNIQUE constraint failed: registered_storage_target.name",
    );
    const res = await POST(
      postReq({ name: "dup", kind: "nfs", config: { storageClassName: "nfs-client" } }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("NAME_TAKEN");
  });

  it("non-UNIQUE DB error is NOT masked as 409 → 500", async () => {
    dbState.insertError = new Error("SQLITE_IOERR: disk I/O error");
    const res = await POST(
      postReq({ name: "x", kind: "nfs", config: { storageClassName: "nfs-client" } }),
    );
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/storage-targets/:id", () => {
  it("rejects a discovered StorageClass id (sc:) → 400 NOT_DELETABLE", async () => {
    const res = await DELETE(...delReq("sc:longhorn"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("NOT_DELETABLE");
    expect(deletes.length).toBe(0);
  });

  it("rejects a discovered node id (node:) → 400 NOT_DELETABLE", async () => {
    const res = await DELETE(...delReq("node:worker-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("NOT_DELETABLE");
  });

  it("rejects the default id → 400", async () => {
    const res = await DELETE(...delReq("default"));
    expect(res.status).toBe(400);
  });

  it("deletes a registered reg:<uuid> row → 200", async () => {
    const res = await DELETE(...delReq("reg:reg-uuid"));
    expect(res.status).toBe(200);
    expect(deletes.length).toBe(1);
    const body = await res.json();
    expect(body.deleted.id).toBe("reg-uuid");
  });

  it("404 when the registered row is missing", async () => {
    dbState.regRow = undefined;
    const res = await DELETE(...delReq("reg:gone"));
    expect(res.status).toBe(404);
  });

  it("operator is forbidden (admin-only) → 403", async () => {
    authState.user = { id: "op", email: "op@example.com", role: "operator" };
    const res = await DELETE(...delReq("reg:reg-uuid"));
    expect(res.status).toBe(403);
  });
});
