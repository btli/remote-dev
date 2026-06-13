// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { TrackUsageLimitUseCase } from "./TrackUsageLimitUseCase";
import type { UsageLimitStateRepository } from "@/application/ports/UsageLimitStateRepository";
import { LimitState } from "@/domain/value-objects/LimitState";

/**
 * In-memory fake that mirrors the real repository's `onlyIfNewer` staleness
 * guard (compare stored `lastCheckedAt`). No DB.
 */
class FakeStateRepo implements UsageLimitStateRepository {
  readonly store = new Map<string, LimitState>();

  async findByProfileId(profileId: string): Promise<LimitState | null> {
    return this.store.get(profileId) ?? null;
  }

  async findManyByProfileIds(ids: string[]): Promise<Map<string, LimitState>> {
    const out = new Map<string, LimitState>();
    for (const id of ids) {
      const s = this.store.get(id);
      if (s) out.set(id, s);
    }
    return out;
  }

  async upsert(state: LimitState, opts?: { onlyIfNewer?: Date }): Promise<void> {
    if (opts?.onlyIfNewer) {
      const existing = this.store.get(state.getProfileId());
      const existingChecked = existing?.getLastCheckedAt();
      // Skip when a strictly-newer observation already won.
      if (existingChecked && existingChecked.getTime() > opts.onlyIfNewer.getTime()) {
        return;
      }
    }
    this.store.set(state.getProfileId(), state);
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
      profileId: "p1",
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
      profileId: "p1",
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
      profileId: "p1",
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
      profileId: "p1",
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
        profileId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        resetAt5h: new Date("2026-06-13T17:00:00Z"),
      });
      expect(wasNewlyLimited).toBe(true);
    });

    it("is true when transitioning available → limited", async () => {
      await useCase.execute({
        profileId: "p1",
        userId: "u1",
        source: "poller",
        isLimited: false,
        observedAt: new Date("2026-06-13T10:00:00Z"),
      });
      const { wasNewlyLimited } = await useCase.execute({
        profileId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        observedAt: new Date("2026-06-13T11:00:00Z"),
      });
      expect(wasNewlyLimited).toBe(true);
    });

    it("is FALSE on a repeat 'still limited' observation (no double-relaunch)", async () => {
      await useCase.execute({
        profileId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        observedAt: new Date("2026-06-13T10:00:00Z"),
      });
      const { wasNewlyLimited } = await useCase.execute({
        profileId: "p1",
        userId: "u1",
        source: "reactive",
        isLimited: true,
        observedAt: new Date("2026-06-13T11:00:00Z"),
      });
      expect(wasNewlyLimited).toBe(false);
    });

    it("is FALSE for an available observation", async () => {
      const { wasNewlyLimited } = await useCase.execute({
        profileId: "p1",
        userId: "u1",
        source: "manual",
        isLimited: false,
      });
      expect(wasNewlyLimited).toBe(false);
    });
  });

  it("does NOT clobber a strictly-newer stored observation (staleness guard)", async () => {
    const newer = new Date("2026-06-13T12:00:00Z");
    const older = new Date("2026-06-13T11:00:00Z");

    // A fresh reading lands first.
    await useCase.execute({
      profileId: "p1",
      userId: "u1",
      source: "poller",
      isLimited: true,
      resetAt5h: new Date("2026-06-13T17:00:00Z"),
      observedAt: newer,
    });

    // A stale reactive reading arrives late — must be ignored.
    await useCase.execute({
      profileId: "p1",
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
      profileId: "p1",
      userId: "u1",
      source: "poller",
      isLimited: true,
      observedAt: newer,
    });

    // Manual "mark available" with an older timestamp must still take effect.
    const { state: result } = await useCase.execute({
      profileId: "p1",
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
