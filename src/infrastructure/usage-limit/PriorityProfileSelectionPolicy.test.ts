// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  PriorityProfileSelectionPolicy,
  type ProjectProfileLink,
} from "./PriorityProfileSelectionPolicy";
import type {
  ProfilePoolRepository,
  PoolEntry,
  PoolSummary,
} from "@/application/ports/ProfilePoolRepository";
import type { UsageLimitStateRepository } from "@/application/ports/UsageLimitStateRepository";
import type {
  UsageLimitWindow,
  UsageLimitWindowRepository,
} from "@/application/ports/UsageLimitWindowRepository";
import { LimitState } from "@/domain/value-objects/LimitState";
import { UsageWindow } from "@/domain/value-objects/UsageWindow";

const NOW = new Date("2026-06-13T12:00:00Z");

/** Fake pool repo: pre-seeded poolId → members. Only reads are exercised. */
class FakePoolRepo implements ProfilePoolRepository {
  constructor(private readonly pools: Map<string, PoolEntry[]>) {}
  async membersOfPool(poolId: string): Promise<PoolEntry[]> {
    return this.pools.get(poolId) ?? [];
  }
  async poolsForUser(): Promise<PoolSummary[]> {
    return [];
  }
  async getPool(): Promise<PoolSummary | null> {
    return null;
  }
  async createPool(): Promise<string> {
    return "x";
  }
  async renamePool(): Promise<void> {}
  async deletePool(): Promise<void> {}
  async addMember(): Promise<void> {}
  async removeMember(): Promise<void> {}
  async setPriority(): Promise<void> {}
}

/** Fake state repo: pre-seeded accountId → LimitState. */
class FakeStateRepo implements UsageLimitStateRepository {
  constructor(private readonly states: Map<string, LimitState>) {}
  async findByAccountId(accountId: string): Promise<LimitState | null> {
    return this.states.get(accountId) ?? null;
  }
  async findManyByAccountIds(ids: string[]): Promise<Map<string, LimitState>> {
    const out = new Map<string, LimitState>();
    for (const id of ids) {
      const s = this.states.get(id);
      if (s) out.set(id, s);
    }
    return out;
  }
  async upsert(): Promise<boolean> {
    return true;
  }
  async listForUser(): Promise<LimitState[]> {
    return [...this.states.values()];
  }
}

/** Fake window repo: pre-seeded accountId → per-model usage windows. */
class FakeWindowRepo implements UsageLimitWindowRepository {
  constructor(private readonly windows: Map<string, UsageLimitWindow[]>) {}
  async replaceForAccount(): Promise<boolean> {
    return true;
  }
  async findByAccountId(accountId: string): Promise<UsageLimitWindow[]> {
    return this.windows.get(accountId) ?? [];
  }
  async findManyByAccountIds(
    ids: string[]
  ): Promise<Map<string, UsageLimitWindow[]>> {
    const out = new Map<string, UsageLimitWindow[]>();
    for (const id of ids) {
      const w = this.windows.get(id);
      if (w) out.set(id, w);
    }
    return out;
  }
}

/** A per-model weekly window, defaulting to the live exhausted-Fable case. */
function scopedWindow(over: Partial<UsageLimitWindow> = {}): UsageLimitWindow {
  return {
    kind: "weekly_scoped",
    group: "weekly",
    percent: 100,
    severity: "critical",
    resetsAt: new Date("2026-06-20T00:00:00Z"), // after NOW
    scopeModel: "Fable",
    scopeSurface: null,
    isActive: true,
    ...over,
  };
}

/** A limited state whose reset is in the future (still limited at NOW). */
function limited(accountId: string): LimitState {
  return LimitState.limited(accountId, {
    windows: [UsageWindow.create("5h", 100, new Date("2026-06-13T17:00:00Z"))],
    source: "reactive",
    lastCheckedAt: NOW,
  });
}

/** An explicitly-available state. */
function available(accountId: string): LimitState {
  return LimitState.available(accountId, { source: "reactive", lastCheckedAt: NOW });
}

function makePolicy(opts: {
  link: ProjectProfileLink | null;
  inheritedPoolId?: string | null;
  pools?: Map<string, PoolEntry[]>;
  states?: Map<string, LimitState>;
  windows?: Map<string, UsageLimitWindow[]>;
}): PriorityProfileSelectionPolicy {
  return new PriorityProfileSelectionPolicy(
    new FakePoolRepo(opts.pools ?? new Map()),
    new FakeStateRepo(opts.states ?? new Map()),
    async () => opts.link,
    async () => opts.inheritedPoolId ?? null,
    // No legacy profile→account bridging in these tests: links are already
    // account-shaped. [remote-dev-n4x4.6]
    async () => null,
    async (ids) => new Map(ids.map((id) => [id, null])),
    new FakeWindowRepo(opts.windows ?? new Map())
  );
}

describe("PriorityProfileSelectionPolicy.selectForProject", () => {
  it("returns null when nothing is configured (no primary, no pool)", async () => {
    const policy = makePolicy({ link: null });
    expect(await policy.selectForProject("proj", "u1", NOW)).toBeNull();
  });

  it("returns the primary when it is the only candidate and available", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: "primary", poolId: null },
      states: new Map([["primary", available("primary")]]),
    });
    expect((await policy.selectForProject("proj", "u1", NOW))?.accountId).toBe("primary");
  });

  it("returns the primary even when never observed (treated as available)", async () => {
    const policy = makePolicy({ link: { profileId: null, accountId: "primary", poolId: null } });
    expect((await policy.selectForProject("proj", "u1", NOW))?.accountId).toBe("primary");
  });

  it("returns the (limited) primary when it is set, has NO pool, and is limited (best-effort, never null)", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: "primary", poolId: null },
      states: new Map([["primary", limited("primary")]]),
    });
    // No pool + the only candidate is limited → fall through to best-effort
    // (the primary) rather than dropping the project to no-profile.
    expect((await policy.selectForProject("proj", "u1", NOW))?.accountId).toBe("primary");
  });

  it("prefers the primary over pool members when the primary is available", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: "primary", poolId: "pool-1" },
      pools: new Map([
        [
          "pool-1",
          [
            { accountId: "m1", priority: 0 },
            { accountId: "m2", priority: 1 },
          ],
        ],
      ]),
      states: new Map([
        ["primary", available("primary")],
        ["m1", available("m1")],
      ]),
    });
    expect((await policy.selectForProject("proj", "u1", NOW))?.accountId).toBe("primary");
  });

  it("rotates to the next available pool member when the primary is limited", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: "primary", poolId: "pool-1" },
      pools: new Map([
        [
          "pool-1",
          [
            { accountId: "m1", priority: 0 },
            { accountId: "m2", priority: 1 },
          ],
        ],
      ]),
      states: new Map([
        ["primary", limited("primary")],
        ["m1", limited("m1")],
        ["m2", available("m2")],
      ]),
    });
    expect((await policy.selectForProject("proj", "u1", NOW))?.accountId).toBe("m2");
  });

  it("resolves the inherited pool when the link has no poolId", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: "primary", poolId: null },
      inheritedPoolId: "inherited-pool",
      pools: new Map([
        ["inherited-pool", [{ accountId: "m1", priority: 0 }]],
      ]),
      states: new Map([
        ["primary", limited("primary")],
        ["m1", available("m1")],
      ]),
    });
    expect((await policy.selectForProject("proj", "u1", NOW))?.accountId).toBe("m1");
  });

  it("prefers the link's poolId over the inherited pool", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: null, poolId: "link-pool" },
      inheritedPoolId: "inherited-pool",
      pools: new Map([
        ["link-pool", [{ accountId: "link-m", priority: 0 }]],
        ["inherited-pool", [{ accountId: "inh-m", priority: 0 }]],
      ]),
      states: new Map([["link-m", available("link-m")]]),
    });
    expect((await policy.selectForProject("proj", "u1", NOW))?.accountId).toBe("link-m");
  });

  it("returns a best-effort primary when ALL candidates are limited (never blocks)", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: "primary", poolId: "pool-1" },
      pools: new Map([["pool-1", [{ accountId: "m1", priority: 0 }]]]),
      states: new Map([
        ["primary", limited("primary")],
        ["m1", limited("m1")],
      ]),
    });
    // Primary is pinned ahead of all members, so it is the best-effort pick.
    expect((await policy.selectForProject("proj", "u1", NOW))?.accountId).toBe("primary");
  });

  it("best-effort falls to the lowest-priority member when there is no primary", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: null, poolId: "pool-1" },
      pools: new Map([
        [
          "pool-1",
          [
            { accountId: "m1", priority: 5 },
            { accountId: "m2", priority: 2 },
          ],
        ],
      ]),
      states: new Map([
        ["m1", limited("m1")],
        ["m2", limited("m2")],
      ]),
    });
    // m2 has the lower priority value (2 < 5) → best-effort pick.
    expect((await policy.selectForProject("proj", "u1", NOW))?.accountId).toBe("m2");
  });
});

describe("PriorityProfileSelectionPolicy.selectNextAvailable", () => {
  it("excludes the current account and returns the next available by priority", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: "primary", poolId: "pool-1" },
      pools: new Map([
        [
          "pool-1",
          [
            { accountId: "m1", priority: 0 },
            { accountId: "m2", priority: 1 },
          ],
        ],
      ]),
      states: new Map([
        ["primary", limited("primary")],
        ["m1", available("m1")],
        ["m2", available("m2")],
      ]),
    });
    const next = await policy.selectNextAvailable("primary", "proj", "u1", NOW);
    expect(next?.accountId).toBe("m1");
  });

  it("never returns the current account even if it is the only available one", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: "primary", poolId: "pool-1" },
      pools: new Map([["pool-1", [{ accountId: "m1", priority: 0 }]]]),
      states: new Map([
        ["primary", available("primary")],
        ["m1", limited("m1")],
      ]),
    });
    const next = await policy.selectNextAvailable("primary", "proj", "u1", NOW);
    expect(next).toBeNull();
  });

  it("returns null when every alternate is limited (all-limited)", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: "primary", poolId: "pool-1" },
      pools: new Map([
        [
          "pool-1",
          [
            { accountId: "m1", priority: 0 },
            { accountId: "m2", priority: 1 },
          ],
        ],
      ]),
      states: new Map([
        ["primary", available("primary")],
        ["m1", limited("m1")],
        ["m2", limited("m2")],
      ]),
    });
    const next = await policy.selectNextAvailable("primary", "proj", "u1", NOW);
    expect(next).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Model-aware selection [remote-dev-n4x4.3]
//
// The scenario these cover is the one the epic exists for: an account whose
// ACCOUNT-level status reads "available" while a per-model weekly window is
// exhausted. Every "no model / no row / unknown model" case must behave exactly
// as the account-level policy did — failing open is the load-bearing property.
// ─────────────────────────────────────────────────────────────────────────────

describe("PriorityProfileSelectionPolicy model awareness", () => {
  /** Primary + one pool member, both account-level available. */
  function twoAccountPolicy(windows?: Map<string, UsageLimitWindow[]>) {
    return makePolicy({
      link: { profileId: null, accountId: "primary", poolId: "pool" },
      pools: new Map([["pool", [{ accountId: "fallback", priority: 0 }]]]),
      states: new Map([
        ["primary", available("primary")],
        ["fallback", available("fallback")],
      ]),
      windows,
    });
  }

  it("rotates past an account whose scoped window for the requested model is critical", async () => {
    const policy = twoAccountPolicy(
      new Map([["primary", [scopedWindow()]]]) // Fable exhausted on the primary
    );

    const selected = await policy.selectForProject(
      "proj",
      "u1",
      NOW,
      "claude-fable-5"
    );

    expect(selected?.accountId).toBe("fallback");
  });

  it("blocks on percent >= 100 even when severity is absent or unrecognized", async () => {
    const policy = twoAccountPolicy(
      new Map([["primary", [scopedWindow({ severity: null, percent: 100 })]]])
    );

    const selected = await policy.selectForProject(
      "proj",
      "u1",
      NOW,
      "claude-fable-5"
    );

    expect(selected?.accountId).toBe("fallback");
  });

  it("keeps the primary when NO model is requested (must not narrow availability)", async () => {
    const policy = twoAccountPolicy(new Map([["primary", [scopedWindow()]]]));

    // Undefined and null are both "the caller did not say" — identical to the
    // pre-n4x4.3 behavior.
    expect((await policy.selectForProject("proj", "u1", NOW))?.accountId).toBe(
      "primary"
    );
    expect(
      (await policy.selectForProject("proj", "u1", NOW, null))?.accountId
    ).toBe("primary");
    expect(
      (await policy.selectForProject("proj", "u1", NOW, "  "))?.accountId
    ).toBe("primary");
  });

  it("keeps the primary when the scoped window is for a DIFFERENT model", async () => {
    const policy = twoAccountPolicy(new Map([["primary", [scopedWindow()]]]));

    const selected = await policy.selectForProject(
      "proj",
      "u1",
      NOW,
      "claude-haiku-4-5"
    );

    expect(selected?.accountId).toBe("primary");
  });

  it("keeps the primary when it has NO scoped row for the requested model", async () => {
    const policy = twoAccountPolicy(new Map()); // no windows recorded at all

    const selected = await policy.selectForProject(
      "proj",
      "u1",
      NOW,
      "claude-fable-5"
    );

    expect(selected?.accountId).toBe("primary");
  });

  it("keeps the primary when the matching scoped window is NOT exhausted", async () => {
    const policy = twoAccountPolicy(
      new Map([
        ["primary", [scopedWindow({ percent: 61, severity: "normal" })]],
      ])
    );

    const selected = await policy.selectForProject(
      "proj",
      "u1",
      NOW,
      "claude-fable-5"
    );

    expect(selected?.accountId).toBe("primary");
  });

  it("ignores an exhausted scoped window whose reset has already passed", async () => {
    const policy = twoAccountPolicy(
      new Map([
        [
          "primary",
          [scopedWindow({ resetsAt: new Date("2026-06-13T11:00:00Z") })],
        ],
      ])
    );

    const selected = await policy.selectForProject(
      "proj",
      "u1",
      NOW,
      "claude-fable-5"
    );

    expect(selected?.accountId).toBe("primary");
  });

  it("ignores ACCOUNT-level windows (scopeModel null) — they belong to the rollup", async () => {
    const policy = twoAccountPolicy(
      new Map([
        [
          "primary",
          [
            scopedWindow({
              kind: "weekly_all",
              scopeModel: null,
              percent: 100,
              severity: "critical",
            }),
          ],
        ],
      ])
    );

    const selected = await policy.selectForProject(
      "proj",
      "u1",
      NOW,
      "claude-fable-5"
    );

    expect(selected?.accountId).toBe("primary");
  });

  it("blocks on a scoped window regardless of what `kind` is called (open set)", async () => {
    // `kind` is an OPEN string set upstream; the structural discriminator is a
    // non-null scopeModel, not today's spelling of the kind.
    const policy = twoAccountPolicy(
      new Map([["primary", [scopedWindow({ kind: "monthly_scoped" })]]])
    );

    const selected = await policy.selectForProject(
      "proj",
      "u1",
      NOW,
      "claude-fable-5"
    );

    expect(selected?.accountId).toBe("fallback");
  });

  it("still returns a best-effort account when EVERY candidate is model-blocked", async () => {
    const policy = twoAccountPolicy(
      new Map([
        ["primary", [scopedWindow()]],
        ["fallback", [scopedWindow()]],
      ])
    );

    // Never block a launch: the most-preferred candidate comes back anyway.
    const selected = await policy.selectForProject(
      "proj",
      "u1",
      NOW,
      "claude-fable-5"
    );

    expect(selected?.accountId).toBe("primary");
  });

  it("applies model awareness to selectNextAvailable as well", async () => {
    const policy = makePolicy({
      link: { profileId: null, accountId: "primary", poolId: "pool" },
      pools: new Map([
        [
          "pool",
          [
            { accountId: "alt-a", priority: 0 },
            { accountId: "alt-b", priority: 1 },
          ],
        ],
      ]),
      states: new Map([
        ["primary", available("primary")],
        ["alt-a", available("alt-a")],
        ["alt-b", available("alt-b")],
      ]),
      windows: new Map([["alt-a", [scopedWindow()]]]),
    });

    const next = await policy.selectNextAvailable(
      "primary",
      "proj",
      "u1",
      NOW,
      "claude-fable-5"
    );

    expect(next?.accountId).toBe("alt-b");
  });

  it("matches on display name case-insensitively (endpoint says 'Fable', caller says an id)", async () => {
    const policy = twoAccountPolicy(
      new Map([["primary", [scopedWindow({ scopeModel: "  fABLE " })]]])
    );

    const selected = await policy.selectForProject(
      "proj",
      "u1",
      NOW,
      "claude-fable-5"
    );

    expect(selected?.accountId).toBe("fallback");
  });
});
