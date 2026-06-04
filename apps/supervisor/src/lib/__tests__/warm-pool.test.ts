import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ warmPool: {}, instance: {} }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

import {
  prewarm,
  claimReady,
  gcExpired,
  type WarmPoolDeps,
  type WarmPoolRow,
} from "../warm-pool";

function poolRow(over: Partial<WarmPoolRow> = {}): WarmPoolRow {
  const now = new Date();
  return {
    id: "wp-1",
    instanceId: "inst-1",
    status: "ready",
    imageTag: null,
    claimedByRunId: null,
    claimedAt: null,
    ttlExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as WarmPoolRow;
}

function makeDeps(over: Partial<WarmPoolDeps> = {}): {
  deps: WarmPoolDeps;
  created: number;
  terminated: string[];
} {
  let created = 0;
  const terminated: string[] = [];
  const deps: WarmPoolDeps = {
    countActive: vi.fn(async () => 0),
    createPooledInstance: vi.fn(async () => {
      created += 1;
      return { instanceId: `inst-${created}`, warmPoolId: `wp-${created}` };
    }),
    claimOneReady: vi.fn(async (runId) =>
      poolRow({ status: "claimed", claimedByRunId: runId }),
    ),
    listExpiredReady: vi.fn(async () => []),
    requestTerminate: vi.fn(async (instanceId) => {
      terminated.push(instanceId);
    }),
    deletePoolRow: vi.fn(async () => {}),
    now: () => new Date("2026-06-03T00:00:00Z"),
    ttlMs: 30 * 60 * 1000,
    ...over,
  };
  return {
    deps,
    get created() {
      return created;
    },
    terminated,
  };
}

describe("prewarm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates instances for the deficit toward the target size", async () => {
    const h = makeDeps({ countActive: vi.fn(async () => 0) });
    await prewarm(2, h.deps);
    expect(h.created).toBe(2);
    expect(h.deps.createPooledInstance).toHaveBeenCalledTimes(2);
  });

  it("creates nothing when the pool is already at/over target", async () => {
    const h = makeDeps({ countActive: vi.fn(async () => 3) });
    await prewarm(2, h.deps);
    expect(h.created).toBe(0);
  });

  it("is a no-op when target size is 0 (disabled)", async () => {
    const h = makeDeps({ countActive: vi.fn(async () => 0) });
    await prewarm(0, h.deps);
    expect(h.deps.createPooledInstance).not.toHaveBeenCalled();
    expect(h.deps.countActive).not.toHaveBeenCalled();
  });
});

describe("claimReady", () => {
  it("atomically claims one ready row and returns it", async () => {
    const h = makeDeps();
    const claimed = await claimReady("run-9", h.deps);
    expect(claimed?.status).toBe("claimed");
    expect(claimed?.claimedByRunId).toBe("run-9");
    expect(h.deps.claimOneReady).toHaveBeenCalledWith("run-9");
  });

  it("returns null when no ready row is available (caller cold-starts)", async () => {
    const h = makeDeps({ claimOneReady: vi.fn(async () => null) });
    expect(await claimReady("run-9", h.deps)).toBeNull();
  });
});

describe("gcExpired", () => {
  it("terminates + deletes only past-TTL unclaimed ready rows", async () => {
    const expired = [
      poolRow({ id: "wp-a", instanceId: "inst-a" }),
      poolRow({ id: "wp-b", instanceId: "inst-b" }),
    ];
    const h = makeDeps({ listExpiredReady: vi.fn(async () => expired) });
    const n = await gcExpired(h.deps);
    expect(n).toBe(2);
    expect(h.terminated).toEqual(["inst-a", "inst-b"]);
    expect(h.deps.deletePoolRow).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no rows are expired", async () => {
    const h = makeDeps({ listExpiredReady: vi.fn(async () => []) });
    expect(await gcExpired(h.deps)).toBe(0);
    expect(h.terminated).toEqual([]);
  });
});
