// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { TrackUsageLimitUseCase } from "./TrackUsageLimitUseCase";
import type { UsageLimitStateRepository } from "@/application/ports/UsageLimitStateRepository";
import type {
  UsageLimitWindow,
  UsageLimitWindowRepository,
} from "@/application/ports/UsageLimitWindowRepository";
import { LimitState } from "@/domain/value-objects/LimitState";

/**
 * In-memory fake that mirrors the real repository's `onlyIfNewer` staleness
 * guard (compare stored `lastCheckedAt`). No DB.
 */
class FakeStateRepo implements UsageLimitStateRepository {
  readonly store = new Map<string, LimitState>();

  async findByAccountId(accountId: string): Promise<LimitState | null> {
    return this.store.get(accountId) ?? null;
  }

  async findManyByAccountIds(ids: string[]): Promise<Map<string, LimitState>> {
    const out = new Map<string, LimitState>();
    for (const id of ids) {
      const s = this.store.get(id);
      if (s) out.set(id, s);
    }
    return out;
  }

  async upsert(state: LimitState, opts?: { onlyIfNewer?: Date }): Promise<boolean> {
    if (opts?.onlyIfNewer) {
      const existing = this.store.get(state.getAccountId());
      const existingChecked = existing?.getLastCheckedAt();
      // Skip when a strictly-newer observation already won.
      if (existingChecked && existingChecked.getTime() > opts.onlyIfNewer.getTime()) {
        return false;
      }
    }
    this.store.set(state.getAccountId(), state);
    return true;
  }

  async listForUser(): Promise<LimitState[]> {
    return [...this.store.values()];
  }
}

describe("TrackUsageLimitUseCase", () => {
  let repo: FakeStateRepo;
  let useCase: TrackUsageLimitUseCase;

  beforeEach(() => {
    repo = new FakeStateRepo();
    useCase = new TrackUsageLimitUseCase(repo);
  });

  it("records an available state with no windows", async () => {
    const { state } = await useCase.execute({
      accountId: "p1",
      userId: "u1",
      source: "reactive",
      isLimited: false,
    });

    expect(state.isLimited()).toBe(false);
    expect(state.getWindows()).toHaveLength(0);
    expect(state.getSource()).toBe("reactive");
    expect(repo.store.get("p1")).toBeDefined();
  });

  it("builds a limited state with a 5h reset window", async () => {
    const reset = new Date("2026-06-13T15:00:00Z");
    const { state } = await useCase.execute({
      accountId: "p1",
      userId: "u1",
      source: "reactive",
      isLimited: true,
      resetAt5h: reset,
    });

    expect(state.isLimited()).toBe(true);
    const windows = state.getWindows();
    expect(windows).toHaveLength(1);
    expect(windows[0].getDuration()).toBe("5h");
    // No pct observed but limited → recorded at 100%.
    expect(windows[0].getUtilizationPct()).toBe(100);
    expect(state.earliestResetAt()?.getTime()).toBe(reset.getTime());
  });

  it("builds both 5h and 7d windows from percentages", async () => {
    const { state } = await useCase.execute({
      accountId: "p1",
      userId: "u1",
      source: "poller",
      isLimited: false,
      window5hPct: 42,
      window7dPct: 88,
    });

    const windows = state.getWindows();
    expect(windows).toHaveLength(2);
    expect(windows.find((w) => w.getDuration() === "5h")?.getUtilizationPct()).toBe(42);
    expect(windows.find((w) => w.getDuration() === "7d")?.getUtilizationPct()).toBe(88);
  });

  it("clamps out-of-range percentages into 0-100", async () => {
    const { state } = await useCase.execute({
      accountId: "p1",
      userId: "u1",
      source: "poller",
      window5hPct: 150,
      window7dPct: -10,
    });
    const windows = state.getWindows();
    expect(windows.find((w) => w.getDuration() === "5h")?.getUtilizationPct()).toBe(100);
    expect(windows.find((w) => w.getDuration() === "7d")?.getUtilizationPct()).toBe(0);
  });

  describe("wasNewlyLimited", () => {
    it("is true on the first limited observation (no prior state)", async () => {
      const { wasNewlyLimited } = await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        resetAt5h: new Date("2026-06-13T17:00:00Z"),
      });
      expect(wasNewlyLimited).toBe(true);
    });

    it("is true when transitioning available → limited", async () => {
      await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "poller",
        isLimited: false,
        observedAt: new Date("2026-06-13T10:00:00Z"),
      });
      const { wasNewlyLimited } = await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        observedAt: new Date("2026-06-13T11:00:00Z"),
      });
      expect(wasNewlyLimited).toBe(true);
    });

    it("is FALSE on a repeat 'still limited' observation (no double-relaunch)", async () => {
      await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        observedAt: new Date("2026-06-13T10:00:00Z"),
      });
      const { wasNewlyLimited } = await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        observedAt: new Date("2026-06-13T11:00:00Z"),
      });
      expect(wasNewlyLimited).toBe(false);
    });

    it("is FALSE for an available observation", async () => {
      const { wasNewlyLimited } = await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "manual",
        isLimited: false,
      });
      expect(wasNewlyLimited).toBe(false);
    });

    it("is TRUE when a NEW limit follows a prior limit whose reset already passed", async () => {
      // Prior episode: limited, but its 5h reset is in the PAST relative to the
      // new observation. `isLimited()` is still raw-true, but
      // `isAvailableNow(observedAt)` is true (reset has passed), so the gate
      // must treat the new observation as a fresh episode.
      const priorObservedAt = new Date("2026-06-13T05:00:00Z");
      const priorReset = new Date("2026-06-13T06:00:00Z"); // already past below
      await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        resetAt5h: priorReset,
        observedAt: priorObservedAt,
      });

      const observedAt = new Date("2026-06-13T10:00:00Z"); // after priorReset
      const prior = await repo.findByAccountId("p1");
      // Sanity: the prior row reads as available at the new observation time.
      expect(prior?.isLimited()).toBe(true);
      expect(prior?.isAvailableNow(observedAt)).toBe(true);

      const { wasNewlyLimited } = await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        resetAt5h: new Date("2026-06-13T15:00:00Z"),
        observedAt,
      });
      expect(wasNewlyLimited).toBe(true);
    });
  });

  describe("wrote", () => {
    it("is true on a normal write", async () => {
      const { wrote } = await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        observedAt: new Date("2026-06-13T11:00:00Z"),
      });
      expect(wrote).toBe(true);
    });

    it("is false when the staleness guard drops the write", async () => {
      const newer = new Date("2026-06-13T12:00:00Z");
      const older = new Date("2026-06-13T11:00:00Z");

      await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "poller",
        isLimited: true,
        observedAt: newer,
      });

      // A stale automated reading arrives late — the guard drops it.
      const { wrote } = await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: false,
        observedAt: older,
      });
      expect(wrote).toBe(false);
    });

    it("is true for a manual override even over a newer reading (guard bypassed)", async () => {
      const newer = new Date("2026-06-13T12:00:00Z");
      const older = new Date("2026-06-13T11:00:00Z");

      await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "poller",
        isLimited: true,
        observedAt: newer,
      });

      const { wrote } = await useCase.execute({
        accountId: "p1",
        userId: "u1",
        source: "manual",
        isLimited: false,
        observedAt: older,
      });
      expect(wrote).toBe(true);
    });
  });

  it("does NOT clobber a strictly-newer stored observation (staleness guard)", async () => {
    const newer = new Date("2026-06-13T12:00:00Z");
    const older = new Date("2026-06-13T11:00:00Z");

    // A fresh reading lands first.
    await useCase.execute({
      accountId: "p1",
      userId: "u1",
      source: "poller",
      isLimited: true,
      resetAt5h: new Date("2026-06-13T17:00:00Z"),
      observedAt: newer,
    });

    // A stale reactive reading arrives late — must be ignored.
    await useCase.execute({
      accountId: "p1",
      userId: "u1",
      source: "reactive",
      isLimited: false,
      observedAt: older,
    });

    const stored = repo.store.get("p1");
    expect(stored?.isLimited()).toBe(true);
    expect(stored?.getLastCheckedAt()?.getTime()).toBe(newer.getTime());
    expect(stored?.getSource()).toBe("poller");
  });

  it("lets a manual override win even over a newer automated reading", async () => {
    const newer = new Date("2026-06-13T12:00:00Z");
    const older = new Date("2026-06-13T11:00:00Z");

    await useCase.execute({
      accountId: "p1",
      userId: "u1",
      source: "poller",
      isLimited: true,
      observedAt: newer,
    });

    // Manual "mark available" with an older timestamp must still take effect.
    const { state: result } = await useCase.execute({
      accountId: "p1",
      userId: "u1",
      source: "manual",
      isLimited: false,
      observedAt: older,
    });

    expect(result.isLimited()).toBe(false);
    expect(repo.store.get("p1")?.isLimited()).toBe(false);
    expect(repo.store.get("p1")?.getSource()).toBe("manual");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-window persistence + write ordering [remote-dev-n4x4.2 / review G6]
// ─────────────────────────────────────────────────────────────────────────────

/** In-memory fake of the window repository, with a failure switch. */
class FakeWindowRepo implements UsageLimitWindowRepository {
  readonly store = new Map<string, UsageLimitWindow[]>();
  readonly calls: { accountId: string; observedAt: Date }[] = [];
  shouldThrow = false;

  async replaceForAccount(
    accountId: string,
    windows: UsageLimitWindow[],
    observedAt: Date
  ): Promise<boolean> {
    if (this.shouldThrow) throw new Error("window write failed");
    this.calls.push({ accountId, observedAt });
    this.store.set(accountId, windows);
    return true;
  }
  async findByAccountId(accountId: string): Promise<UsageLimitWindow[]> {
    return this.store.get(accountId) ?? [];
  }
  async findManyByAccountIds(
    ids: string[]
  ): Promise<Map<string, UsageLimitWindow[]>> {
    const out = new Map<string, UsageLimitWindow[]>();
    for (const id of ids) {
      const w = this.store.get(id);
      if (w) out.set(id, w);
    }
    return out;
  }
}

function scoped(): UsageLimitWindow {
  return {
    kind: "weekly_scoped",
    group: "weekly",
    percent: 100,
    severity: "critical",
    resetsAt: new Date("2026-08-09T00:00:00Z"),
    scopeModel: "Fable",
    scopeSurface: null,
    isActive: true,
  };
}

describe("TrackUsageLimitUseCase window persistence", () => {
  it("persists windows alongside the rollup, stamped with the observation time", async () => {
    const states = new FakeStateRepo();
    const windows = new FakeWindowRepo();
    const useCase = new TrackUsageLimitUseCase(states, windows);
    const observedAt = new Date("2026-08-02T09:00:00Z");

    const result = await useCase.execute({
      accountId: "acct-1",
      userId: "u1",
      source: "poller",
      windows: [scoped()],
      observedAt,
    });

    expect(result.wrote).toBe(true);
    expect(windows.store.get("acct-1")).toHaveLength(1);
    expect(windows.calls[0].observedAt).toBe(observedAt);
    expect(states.store.get("acct-1")).toBeDefined();
  });

  it("leaves stored windows ALONE when the source reports none (undefined)", async () => {
    // A reactive scrollback parse has no per-window detail; its narrower
    // observation must not wipe richer data a poll recorded.
    const states = new FakeStateRepo();
    const windows = new FakeWindowRepo();
    windows.store.set("acct-1", [scoped()]);
    const useCase = new TrackUsageLimitUseCase(states, windows);

    await useCase.execute({
      accountId: "acct-1",
      userId: "u1",
      source: "reactive",
      isLimited: true,
    });

    expect(windows.calls).toHaveLength(0);
    expect(windows.store.get("acct-1")).toHaveLength(1);
  });

  it("CLEARS stored windows on an explicit empty array", async () => {
    const states = new FakeStateRepo();
    const windows = new FakeWindowRepo();
    windows.store.set("acct-1", [scoped()]);
    const useCase = new TrackUsageLimitUseCase(states, windows);

    await useCase.execute({
      accountId: "acct-1",
      userId: "u1",
      source: "poller",
      windows: [],
    });

    expect(windows.store.get("acct-1")).toEqual([]);
  });

  it("does NOT write the rollup when the window write fails", async () => {
    // [review G6] The dangerous divergence is a FRESH rollup saying "available"
    // beside STALE windows still saying a model is critical. Writing windows
    // first, and aborting on failure, makes that state unreachable.
    const states = new FakeStateRepo();
    const windows = new FakeWindowRepo();
    windows.shouldThrow = true;
    const useCase = new TrackUsageLimitUseCase(states, windows);

    const result = await useCase.execute({
      accountId: "acct-1",
      userId: "u1",
      source: "poller",
      windows: [scoped()],
    });

    expect(result.wrote).toBe(false);
    expect(states.store.has("acct-1")).toBe(false);
  });

  it("works with no window repository at all (rollup-only construction)", async () => {
    const states = new FakeStateRepo();
    const useCase = new TrackUsageLimitUseCase(states);

    const result = await useCase.execute({
      accountId: "acct-1",
      userId: "u1",
      source: "poller",
      windows: [scoped()],
    });

    expect(result.wrote).toBe(true);
  });
});
