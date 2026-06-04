import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for POST /api/delegate (epic remote-dev-oyej.11): delegate to a ready
 * instance (shared dispatch), 404 for a missing slug without provisioning, and
 * provision-if-missing → 202 with a new `requested` row.
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
const inserts: Record<string, unknown>[] = [];
vi.mock("@/db", () => ({
  db: {
    query: { instance: { findFirst: async () => dbState.row } },
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          inserts.push(values);
          return [{ id: "new-inst", slug: values.slug, ...values }];
        },
      }),
    }),
  },
}));

vi.mock("@/lib/slug", () => ({
  validateSlug: (s: unknown) => ({ valid: typeof s === "string", message: "" }),
  namespaceForSlug: (s: string) => `rdv-${s}`,
}));
vi.mock("@/lib/storage", () => ({
  resolveStorageTarget: async () => ({
    id: "st-1",
    configSnapshot: {},
    size: "10Gi",
  }),
  StorageTargetResolutionError: class extends Error {},
}));

const dispatchMock = vi.fn(async () =>
  Response.json({ id: "run-1", status: "running" }, { status: 202 }),
);
vi.mock("@/lib/agent-dispatch", () => ({
  dispatchAgentRun: (...args: unknown[]) => dispatchMock(...(args as [])),
}));

import { POST } from "@/app/api/delegate/route";

function req(body: unknown): [Request, undefined] {
  return [
    new Request("https://sup.example.com/api/delegate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    undefined,
  ];
}

beforeEach(() => {
  authState.user = { id: "op-1", email: "op@example.com", role: "operator" };
  dbState.row = undefined;
  inserts.length = 0;
  dispatchMock.mockClear();
});

describe("POST /api/delegate", () => {
  it("delegates to an existing ready instance via the shared dispatcher", async () => {
    dbState.row = { id: "inst-1", slug: "beta", ownerId: "op-1", status: "ready" };
    const res = await POST(
      ...req({ toSlug: "beta", projectId: "p1", prompt: "go" }),
    );
    expect(res.status).toBe(202);
    expect(dispatchMock).toHaveBeenCalledOnce();
    expect(inserts).toHaveLength(0);
  });

  it("404 for a missing slug without provisionIfMissing", async () => {
    const res = await POST(
      ...req({ toSlug: "ghost", projectId: "p1", prompt: "go" }),
    );
    expect(res.status).toBe(404);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("provisions a new requested instance with provisionIfMissing (202)", async () => {
    const res = await POST(
      ...req({
        toSlug: "fresh",
        projectId: "p1",
        prompt: "go",
        provisionIfMissing: true,
      }),
    );
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toMatchObject({ status: "provisioning", slug: "fresh" });
    // Inserted a `requested` instance + an audit row.
    expect(inserts.some((v) => v.status === "requested")).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("404 when the target exists but the caller is not the owner", async () => {
    dbState.row = { id: "inst-1", slug: "beta", ownerId: "other", status: "ready" };
    const res = await POST(
      ...req({ toSlug: "beta", projectId: "p1", prompt: "go" }),
    );
    expect(res.status).toBe(404);
  });

  it("400 when toSlug/projectId/prompt are missing", async () => {
    const res = await POST(...req({ projectId: "p1" }));
    expect(res.status).toBe(400);
  });
});
