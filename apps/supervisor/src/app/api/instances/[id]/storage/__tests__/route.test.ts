import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";
import { InspectorPathError, InspectorPendingError } from "@/lib/inspector-service";

/**
 * Tests for GET /api/instances/:id/storage (operator + owner). Owner-scoping →
 * 404; degrades to 200 (empty listing + note) when no cluster is reachable, never
 * 500. A bad path → 400; a node-pinned-while-stopped volume → 200 + note.
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

const svc: {
  clientsThrow: boolean;
  listVolume: (...args: unknown[]) => Promise<unknown>;
} = {
  clientsThrow: false,
  listVolume: vi.fn(async () => ({ path: "", entries: [], truncated: false })),
};
vi.mock("@/lib/inspector-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inspector-service")>(
    "@/lib/inspector-service",
  );
  return {
    ...actual,
    defaultClients: () => {
      if (svc.clientsThrow) throw new Error("Kubernetes config unavailable");
      return {};
    },
    listVolume: (...args: unknown[]) => svc.listVolume(...args),
  };
});

import { GET } from "@/app/api/instances/[id]/storage/route";

function req(id: string, qs = ""): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/instances/${id}/storage${qs}`),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "ready" };
  svc.clientsThrow = false;
  svc.listVolume = vi.fn(async () => ({
    path: "",
    entries: [{ name: "a", type: "file", size: 1, mtimeMs: 0 }],
    truncated: false,
  }));
  authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
});

describe("GET /api/instances/:id/storage", () => {
  it("returns { listing } on success", async () => {
    const res = await GET(...req("inst-1", "?path=/"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.listing.entries).toHaveLength(1);
  });

  it("no cluster → 200 empty listing + note (never 500)", async () => {
    svc.clientsThrow = true;
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.note).toBe("k8s unavailable");
    expect(data.listing.entries).toEqual([]);
  });

  it("bad path → 400 INVALID_PATH", async () => {
    svc.listVolume = vi.fn(async () => {
      throw new InspectorPathError("path traversal not allowed");
    });
    const res = await GET(...req("inst-1", "?path=../x"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_PATH");
  });

  it("node-pinned while stopped → 200 + note (Pending), never 500", async () => {
    svc.listVolume = vi.fn(async () => {
      throw new InspectorPendingError("Could not mount the volume — Start it to browse.");
    });
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.note).toContain("Could not mount");
    expect(data.listing.entries).toEqual([]);
  });

  it("non-owner operator → 404 (not 403)", async () => {
    authState.user = { id: "other", email: "o@example.com", role: "operator" };
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(404);
  });

  it("viewer → 403 (operator role gate)", async () => {
    authState.user = { id: "v", email: "v@example.com", role: "viewer" };
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(403);
  });
});
