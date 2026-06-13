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
  async createPool(): Promise<string> {
    return "x";
  }
  async renamePool(): Promise<void> {}
  async deletePool(): Promise<void> {}
  async addMember(): Promise<void> {}
  async removeMember(): Promise<void> {}
  async setPriority(): Promise<void> {}
}

/** Fake state repo: pre-seeded profileId → LimitState. */
class FakeStateRepo implements UsageLimitStateRepository {
  constructor(private readonly states: Map<string, LimitState>) {}
  async findByProfileId(profileId: string): Promise<LimitState | null> {
    return this.states.get(profileId) ?? null;
  }
  async findManyByProfileIds(ids: string[]): Promise<Map<string, LimitState>> {
    const out = new Map<string, LimitState>();
    for (const id of ids) {
      const s = this.states.get(id);
      if (s) out.set(id, s);
    }
    return out;
  }
  async upsert(): Promise<void> {}
  async listForUser(): Promise<LimitState[]> {
    return [...this.states.values()];
  }
}

/** A limited state whose reset is in the future (still limited at NOW). */
function limited(profileId: string): LimitState {
  return LimitState.limited(profileId, {
    windows: [UsageWindow.create("5h", 100, new Date("2026-06-13T17:00:00Z"))],
    source: "reactive",
    lastCheckedAt: NOW,
  });
}

/** An explicitly-available state. */
function available(profileId: string): LimitState {
  return LimitState.available(profileId, { source: "reactive", lastCheckedAt: NOW });
}

function makePolicy(opts: {
  link: ProjectProfileLink | null;
  inheritedPoolId?: string | null;
  pools?: Map<string, PoolEntry[]>;
  states?: Map<string, LimitState>;
}): PriorityProfileSelectionPolicy {
  return new PriorityProfileSelectionPolicy(
    new FakePoolRepo(opts.pools ?? new Map()),
    new FakeStateRepo(opts.states ?? new Map()),
    async () => opts.link,
    async () => opts.inheritedPoolId ?? null
  );
}

describe("PriorityProfileSelectionPolicy.selectForProject", () => {
  it("returns null when nothing is configured (no primary, no pool)", async () => {
    const policy = makePolicy({ link: null });
    expect(await policy.selectForProject("proj", "u1", NOW)).toBeNull();
  });

  it("returns the primary when it is the only candidate and available", async () => {
    const policy = makePolicy({
      link: { profileId: "primary", poolId: null },
      states: new Map([["primary", available("primary")]]),
    });
    expect(await policy.selectForProject("proj", "u1", NOW)).toBe("primary");
  });

  it("returns the primary even when never observed (treated as available)", async () => {
    const policy = makePolicy({ link: { profileId: "primary", poolId: null } });
    expect(await policy.selectForProject("proj", "u1", NOW)).toBe("primary");
  });

  it("prefers the primary over pool members when the primary is available", async () => {
    const policy = makePolicy({
      link: { profileId: "primary", poolId: "pool-1" },
      pools: new Map([
        [
          "pool-1",
          [
            { profileId: "m1", priority: 0 },
            { profileId: "m2", priority: 1 },
          ],
        ],
      ]),
      states: new Map([
        ["primary", available("primary")],
        ["m1", available("m1")],
      ]),
    });
    expect(await policy.selectForProject("proj", "u1", NOW)).toBe("primary");
  });

  it("rotates to the next available pool member when the primary is limited", async () => {
    const policy = makePolicy({
      link: { profileId: "primary", poolId: "pool-1" },
      pools: new Map([
        [
          "pool-1",
          [
            { profileId: "m1", priority: 0 },
            { profileId: "m2", priority: 1 },
          ],
        ],
      ]),
      states: new Map([
        ["primary", limited("primary")],
        ["m1", limited("m1")],
        ["m2", available("m2")],
      ]),
    });
    expect(await policy.selectForProject("proj", "u1", NOW)).toBe("m2");
  });

  it("resolves the inherited pool when the link has no poolId", async () => {
    const policy = makePolicy({
      link: { profileId: "primary", poolId: null },
      inheritedPoolId: "inherited-pool",
      pools: new Map([
        ["inherited-pool", [{ profileId: "m1", priority: 0 }]],
      ]),
      states: new Map([
        ["primary", limited("primary")],
        ["m1", available("m1")],
      ]),
    });
    expect(await policy.selectForProject("proj", "u1", NOW)).toBe("m1");
  });

  it("prefers the link's poolId over the inherited pool", async () => {
    const policy = makePolicy({
      link: { profileId: null, poolId: "link-pool" },
      inheritedPoolId: "inherited-pool",
      pools: new Map([
        ["link-pool", [{ profileId: "link-m", priority: 0 }]],
        ["inherited-pool", [{ profileId: "inh-m", priority: 0 }]],
      ]),
      states: new Map([["link-m", available("link-m")]]),
    });
    expect(await policy.selectForProject("proj", "u1", NOW)).toBe("link-m");
  });

  it("returns a best-effort primary when ALL candidates are limited (never blocks)", async () => {
    const policy = makePolicy({
      link: { profileId: "primary", poolId: "pool-1" },
      pools: new Map([["pool-1", [{ profileId: "m1", priority: 0 }]]]),
      states: new Map([
        ["primary", limited("primary")],
        ["m1", limited("m1")],
      ]),
    });
    // Primary is pinned ahead of all members, so it is the best-effort pick.
    expect(await policy.selectForProject("proj", "u1", NOW)).toBe("primary");
  });

  it("best-effort falls to the lowest-priority member when there is no primary", async () => {
    const policy = makePolicy({
      link: { profileId: null, poolId: "pool-1" },
      pools: new Map([
        [
          "pool-1",
          [
            { profileId: "m1", priority: 5 },
            { profileId: "m2", priority: 2 },
          ],
        ],
      ]),
      states: new Map([
        ["m1", limited("m1")],
        ["m2", limited("m2")],
      ]),
    });
    // m2 has the lower priority value (2 < 5) → best-effort pick.
    expect(await policy.selectForProject("proj", "u1", NOW)).toBe("m2");
  });
});

describe("PriorityProfileSelectionPolicy.selectNextAvailable", () => {
  it("excludes the current profile and returns the next available by priority", async () => {
    const policy = makePolicy({
      link: { profileId: "primary", poolId: "pool-1" },
      pools: new Map([
        [
          "pool-1",
          [
            { profileId: "m1", priority: 0 },
            { profileId: "m2", priority: 1 },
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
    expect(next).toBe("m1");
  });

  it("never returns the current profile even if it is the only available one", async () => {
    const policy = makePolicy({
      link: { profileId: "primary", poolId: "pool-1" },
      pools: new Map([["pool-1", [{ profileId: "m1", priority: 0 }]]]),
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
      link: { profileId: "primary", poolId: "pool-1" },
      pools: new Map([
        [
          "pool-1",
          [
            { profileId: "m1", priority: 0 },
            { profileId: "m2", priority: 1 },
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
