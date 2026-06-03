import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/roles";

/**
 * Tests for the shared suspend/resume (Stop/Start) helpers. The /suspend,
 * /resume, /stop, /start routes all funnel through these, so behavior is tested
 * once here. Canonical audit actions remain "suspend"/"resume".
 */

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

import { requestSuspend, requestResume } from "@/lib/lifecycle-actions";

const OWNER = { id: "op-1", email: "op@example.com", role: "operator" as Role };

beforeEach(() => {
  dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "ready" };
  updates.length = 0;
  inserts.length = 0;
});

describe("requestSuspend (Stop)", () => {
  it("ready → 202, suspended + suspendedAt, canonical audit action 'suspend'", async () => {
    const r = await requestSuspend(OWNER, "inst-1");
    expect(r.status).toBe(202);
    expect(updates[0]?.status).toBe("suspended");
    expect(updates[0]?.suspendedAt).toBeInstanceOf(Date);
    expect(inserts.some((i) => i.action === "suspend")).toBe(true);
  });

  it("already suspended → idempotent 202, no write", async () => {
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "suspended" };
    const r = await requestSuspend(OWNER, "inst-1");
    expect(r.status).toBe(202);
    expect(updates.length).toBe(0);
  });

  it("provisioning → 409 INVALID_STATE", async () => {
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "provisioning" };
    const r = await requestSuspend(OWNER, "inst-1");
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("INVALID_STATE");
  });

  it("non-owner operator → 404 (not 403)", async () => {
    const r = await requestSuspend(
      { id: "other", email: "x@example.com", role: "operator" },
      "inst-1",
    );
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("NOT_FOUND");
  });

  it("missing id → 400", async () => {
    const r = await requestSuspend(OWNER, undefined);
    expect(r.status).toBe(400);
  });
});

describe("requestResume (Start)", () => {
  beforeEach(() => {
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "suspended" };
  });

  it("suspended → 202, ready + suspendedAt cleared, canonical audit action 'resume'", async () => {
    const r = await requestResume(OWNER, "inst-1");
    expect(r.status).toBe(202);
    expect(updates[0]?.status).toBe("ready");
    expect(updates[0]?.suspendedAt).toBeNull();
    expect(inserts.some((i) => i.action === "resume")).toBe(true);
  });

  it("already ready → idempotent 202, no write", async () => {
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "ready" };
    const r = await requestResume(OWNER, "inst-1");
    expect(r.status).toBe(202);
    expect(updates.length).toBe(0);
  });

  it("terminating → 409 INVALID_STATE", async () => {
    dbState.row = { id: "inst-1", slug: "alpha", ownerId: "op-1", status: "terminating" };
    const r = await requestResume(OWNER, "inst-1");
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("INVALID_STATE");
  });
});
