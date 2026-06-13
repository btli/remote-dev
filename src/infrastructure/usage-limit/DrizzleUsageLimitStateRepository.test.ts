import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/db", () => ({
  db: {
    query: {
      claudeUsageLimitStates: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      agentProfiles: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock("@/db/schema", () => ({
  claudeUsageLimitStates: { profileId: "profile_id", userId: "user_id" },
  agentProfiles: { id: "id" },
}));

import { db } from "@/db";
import { DrizzleUsageLimitStateRepository } from "./DrizzleUsageLimitStateRepository";

const repo = new DrizzleUsageLimitStateRepository();

/** A minimal usage-limit row with sensible defaults. */
function makeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profileId: "p1",
    userId: "u1",
    limitStatus: "available",
    window5hPct: null,
    window7dPct: null,
    resetAt5h: null,
    resetAt7d: null,
    effectiveResetAt: null,
    detectionSource: null,
    lastCheckedAt: null,
    updatedAt: new Date(),
    ...over,
  };
}

describe("DrizzleUsageLimitStateRepository.rowToLimitState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reconstructs an api_key (rate/credit) reset from effectiveResetAt when no 5h/7d window exists", async () => {
    // A limited api_key row: no 5h/7d window, reset only in effectiveResetAt.
    const reset = new Date("2026-06-13T12:05:00Z");
    (db.query.claudeUsageLimitStates.findFirst as Mock).mockResolvedValue(
      makeRow({ limitStatus: "limited", effectiveResetAt: reset })
    );

    const state = await repo.findByProfileId("p1");
    expect(state).not.toBeNull();
    expect(state!.isLimited()).toBe(true);

    // Critical: it becomes available again at the rate reset (NOT stuck).
    expect(state!.isAvailableNow(new Date("2026-06-13T12:00:00Z"))).toBe(false);
    expect(state!.isAvailableNow(reset)).toBe(true);
    expect(state!.earliestResetAt()?.toISOString()).toBe(
      "2026-06-13T12:05:00.000Z"
    );
  });

  it("still maps a subscription 5h/7d row normally", async () => {
    const reset5h = new Date("2026-06-13T13:00:00Z");
    (db.query.claudeUsageLimitStates.findFirst as Mock).mockResolvedValue(
      makeRow({
        limitStatus: "limited",
        window5hPct: 100,
        resetAt5h: reset5h,
        effectiveResetAt: reset5h,
      })
    );

    const state = await repo.findByProfileId("p1");
    const snap = state!.toSnapshot();
    expect(snap.window5hPct).toBe(100);
    expect(snap.resetAt5h?.toISOString()).toBe("2026-06-13T13:00:00.000Z");
    expect(state!.isAvailableNow(reset5h)).toBe(true);
  });

  it("a limited row with NO reset anywhere stays unavailable", async () => {
    (db.query.claudeUsageLimitStates.findFirst as Mock).mockResolvedValue(
      makeRow({ limitStatus: "limited" })
    );
    const state = await repo.findByProfileId("p1");
    expect(state!.isLimited()).toBe(true);
    expect(state!.isAvailableNow(new Date("2099-01-01T00:00:00Z"))).toBe(false);
  });

  it("returns null for an absent row", async () => {
    (db.query.claudeUsageLimitStates.findFirst as Mock).mockResolvedValue(
      undefined
    );
    expect(await repo.findByProfileId("p1")).toBeNull();
  });
});
