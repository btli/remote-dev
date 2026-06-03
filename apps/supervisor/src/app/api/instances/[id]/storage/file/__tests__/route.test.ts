import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";
import { InspectorError } from "@/lib/inspector-service";

/**
 * Tests for GET /api/instances/:id/storage/file (operator + owner). Streams the
 * file bytes as an attachment; owner-scoping → 404; too-large → 413; no cluster
 * → 503 (never 500).
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
  readFile: (...args: unknown[]) => Promise<unknown>;
} = {
  clientsThrow: false,
  readFile: vi.fn(async () => ({
    path: "a.txt",
    size: 5,
    content: Buffer.from("hello"),
  })),
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
    readFile: (...args: unknown[]) => svc.readFile(...args),
  };
});

import { GET } from "@/app/api/instances/[id]/storage/file/route";

function req(id: string, qs = ""): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://sup.example.com/api/instances/${id}/storage/file${qs}`),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "ready" };
  svc.clientsThrow = false;
  svc.readFile = vi.fn(async () => ({ path: "a.txt", size: 5, content: Buffer.from("hello") }));
  authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
});

describe("GET /api/instances/:id/storage/file", () => {
  it("streams the file as an attachment", async () => {
    const res = await GET(...req("inst-1", "?path=/a.txt"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="a.txt"');
    expect(await res.text()).toBe("hello");
  });

  it("missing ?path → 400 INVALID_PATH", async () => {
    const res = await GET(...req("inst-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_PATH");
  });

  it("too-large → 413 FILE_TOO_LARGE", async () => {
    svc.readFile = vi.fn(async () => {
      throw new InspectorError("file too large (9999999 bytes); use a terminal");
    });
    const res = await GET(...req("inst-1", "?path=/big.bin"));
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("FILE_TOO_LARGE");
  });

  it("no cluster → 503 + note (never 500)", async () => {
    svc.clientsThrow = true;
    const res = await GET(...req("inst-1", "?path=/a.txt"));
    expect(res.status).toBe(503);
    expect((await res.json()).note).toBe("k8s unavailable");
  });

  it("non-owner operator → 404", async () => {
    authState.user = { id: "other", email: "o@example.com", role: "operator" };
    const res = await GET(...req("inst-1", "?path=/a.txt"));
    expect(res.status).toBe(404);
  });
});
