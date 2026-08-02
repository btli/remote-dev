// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// A minimal in-memory stand-in for the Drizzle query builders this repo uses.
// It records the delete/insert calls so we can assert the REPLACE semantics
// (stale rows must not survive a poll) without a real database.
const calls: { deletes: number; inserted: Record<string, unknown>[][] } = {
  deletes: 0,
  inserted: [],
};

/** Rows the staleness guard sees inside the transaction. */
let existingObserved: { observedAt: Date | null }[] = [];

const tx = {
  query: {
    claudeUsageLimitWindows: {
      findMany: () => Promise.resolve(existingObserved),
    },
  },
  delete: () => {
    calls.deletes += 1;
    return { where: () => Promise.resolve(undefined) };
  },
  insert: () => ({
    values: (rows: Record<string, unknown>[]) => {
      calls.inserted.push(rows);
      return Promise.resolve(undefined);
    },
  }),
};

vi.mock("@/db", () => ({
  db: {
    query: {
      claudeUsageLimitWindows: { findMany: vi.fn() },
      claudeAccounts: { findFirst: vi.fn() },
    },
    transaction: (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  },
}));

vi.mock("@/db/schema", () => ({
  claudeUsageLimitWindows: { accountId: "account_id" },
  claudeAccounts: { id: "id" },
}));

import { db } from "@/db";
import { DrizzleUsageLimitWindowRepository } from "./DrizzleUsageLimitWindowRepository";

const repo = new DrizzleUsageLimitWindowRepository();
const findMany = db.query.claudeUsageLimitWindows.findMany as Mock;
const accountFindFirst = db.query.claudeAccounts.findFirst as Mock;

/** A stored row with sensible defaults. */
function makeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "w1",
    accountId: "acct-1",
    userId: "u1",
    kind: "weekly_scoped",
    limitGroup: "weekly",
    percent: 100,
    severity: "critical",
    resetsAt: null,
    scopeModel: "Fable",
    scopeSurface: null,
    isActive: true,
    observedAt: new Date("2026-08-02T09:00:00Z"),
    scopeModelKey: "Fable",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

const OBSERVED = new Date("2026-08-02T09:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  calls.deletes = 0;
  calls.inserted = [];
  existingObserved = [];
  accountFindFirst.mockResolvedValue({ userId: "u1" });
});

describe("DrizzleUsageLimitWindowRepository.replaceForAccount", () => {
  it("deletes the account's existing windows before inserting the new set", async () => {
    const ok = await repo.replaceForAccount("acct-1", [
      {
        kind: "weekly_scoped",
        group: "weekly",
        percent: 100,
        severity: "critical",
        resetsAt: new Date("2026-07-30T22:59:59Z"),
        scopeModel: "Fable",
        scopeSurface: null,
        isActive: true,
      },
    ], OBSERVED);

    expect(ok).toBe(true);
    expect(calls.deletes).toBe(1);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0]).toHaveLength(1);
    expect(calls.inserted[0][0]).toMatchObject({
      accountId: "acct-1",
      userId: "u1",
      kind: "weekly_scoped",
      limitGroup: "weekly",
      scopeModel: "Fable",
    });
  });

  it("clears stale rows when the endpoint reports no windows at all", async () => {
    // A window that disappears upstream must not linger as stale state — the
    // whole reason the write is a replace and not a merge.
    const ok = await repo.replaceForAccount("acct-1", [], OBSERVED);

    expect(ok).toBe(true);
    expect(calls.deletes).toBe(1);
    expect(calls.inserted).toHaveLength(0);
  });

  it("stores unknown kind/group/severity verbatim (open string sets)", async () => {
    await repo.replaceForAccount("acct-1", [
      {
        kind: "monthly_scoped",
        group: "monthly",
        percent: 55,
        severity: "elevated",
        resetsAt: null,
        scopeModel: "Cowork",
        scopeSurface: "code",
        isActive: false,
      },
    ], OBSERVED);

    expect(calls.inserted[0][0]).toMatchObject({
      kind: "monthly_scoped",
      limitGroup: "monthly",
      severity: "elevated",
      scopeModel: "Cowork",
      scopeSurface: "code",
    });
  });

  it("clamps and rounds percent into the 0-100 integer column", async () => {
    await repo.replaceForAccount("acct-1", [
      {
        kind: "a",
        group: null,
        percent: 133.7,
        severity: null,
        resetsAt: null,
        scopeModel: null,
        scopeSurface: null,
        isActive: false,
      },
      {
        kind: "b",
        group: null,
        percent: -5,
        severity: null,
        resetsAt: null,
        scopeModel: null,
        scopeSurface: null,
        isActive: false,
      },
      {
        kind: "c",
        group: null,
        percent: 60.6,
        severity: null,
        resetsAt: null,
        scopeModel: null,
        scopeSurface: null,
        isActive: false,
      },
    ], OBSERVED);

    expect(calls.inserted[0].map((r) => r.percent)).toEqual([100, 0, 61]);
  });

  it("is a no-op (not a throw) when the account has no owner row", async () => {
    accountFindFirst.mockResolvedValue(undefined);

    const ok = await repo.replaceForAccount("ghost", [], OBSERVED);

    expect(ok).toBe(false);
    expect(calls.deletes).toBe(0);
    expect(calls.inserted).toHaveLength(0);
  });
});

describe("DrizzleUsageLimitWindowRepository concurrency guards", () => {
  it("folds a null scopeModel into scopeModelKey so the unique index is portable", async () => {
    // The logical key is (accountId, kind, scopeModel), but scopeModel is
    // nullable and SQLite/PG disagree on NULL collision in a unique index.
    await repo.replaceForAccount("acct-1", [
      {
        kind: "weekly_all",
        group: "weekly",
        percent: 98,
        severity: "critical",
        resetsAt: null,
        scopeModel: null,
        scopeSurface: null,
        isActive: false,
      },
    ], OBSERVED);

    expect(calls.inserted[0][0]).toMatchObject({
      scopeModel: null,
      scopeModelKey: "",
    });
  });

  it("de-dupes on the logical key so a repeated pair cannot fail the write", async () => {
    const dup = {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 50,
      severity: "normal",
      resetsAt: null,
      scopeModel: "Fable",
      scopeSurface: null,
      isActive: false,
    };
    await repo.replaceForAccount(
      "acct-1",
      [dup, { ...dup, percent: 100, severity: "critical" }],
      OBSERVED
    );

    // Last occurrence wins — the response is the truth.
    expect(calls.inserted[0]).toHaveLength(1);
    expect(calls.inserted[0][0]).toMatchObject({ percent: 100 });
  });

  it("skips the write when a strictly-newer observation is already stored", async () => {
    // A slow response finishing last must not overwrite newer data.
    existingObserved = [{ observedAt: new Date("2026-08-02T09:05:00Z") }];

    const ok = await repo.replaceForAccount("acct-1", [], OBSERVED);

    expect(ok).toBe(false);
    expect(calls.deletes).toBe(0);
    expect(calls.inserted).toHaveLength(0);
  });

  it("writes when the stored observation is older or equal", async () => {
    existingObserved = [{ observedAt: new Date("2026-08-02T08:55:00Z") }];

    const ok = await repo.replaceForAccount("acct-1", [], OBSERVED);

    expect(ok).toBe(true);
    expect(calls.deletes).toBe(1);
  });

  it("stamps every row with the observation time", async () => {
    await repo.replaceForAccount("acct-1", [
      {
        kind: "weekly_scoped",
        group: "weekly",
        percent: 100,
        severity: "critical",
        resetsAt: null,
        scopeModel: "Fable",
        scopeSurface: null,
        isActive: true,
      },
    ], OBSERVED);

    expect(calls.inserted[0][0]).toMatchObject({ observedAt: OBSERVED });
  });
});

describe("DrizzleUsageLimitWindowRepository reads", () => {
  it("maps stored rows back onto the port shape", async () => {
    const reset = new Date("2026-07-30T22:59:59Z");
    findMany.mockResolvedValue([makeRow({ resetsAt: reset })]);

    const windows = await repo.findByAccountId("acct-1");

    expect(windows).toEqual([
      {
        kind: "weekly_scoped",
        group: "weekly",
        percent: 100,
        severity: "critical",
        resetsAt: reset,
        scopeModel: "Fable",
        scopeSurface: null,
        isActive: true,
        observedAt: new Date("2026-08-02T09:00:00Z"),
      },
    ]);
  });

  it("round-trips an unknown kind/severity unchanged", async () => {
    findMany.mockResolvedValue([
      makeRow({ kind: "monthly_scoped", severity: "elevated" }),
    ]);

    const windows = await repo.findByAccountId("acct-1");

    expect(windows[0].kind).toBe("monthly_scoped");
    expect(windows[0].severity).toBe("elevated");
  });

  it("groups a multi-account read by accountId and omits accounts with no rows", async () => {
    findMany.mockResolvedValue([
      makeRow({ id: "w1", accountId: "acct-1", scopeModel: "Fable" }),
      makeRow({ id: "w2", accountId: "acct-1", scopeModel: "Opus" }),
      makeRow({ id: "w3", accountId: "acct-2", scopeModel: null }),
    ]);

    const byAccount = await repo.findManyByAccountIds([
      "acct-1",
      "acct-2",
      "acct-3",
    ]);

    expect(byAccount.get("acct-1")).toHaveLength(2);
    expect(byAccount.get("acct-2")).toHaveLength(1);
    expect(byAccount.has("acct-3")).toBe(false);
  });

  it("short-circuits an empty id list without querying", async () => {
    const byAccount = await repo.findManyByAccountIds([]);

    expect(byAccount.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
