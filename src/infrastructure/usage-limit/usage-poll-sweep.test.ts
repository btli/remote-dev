// @vitest-environment node
/**
 * Pacing tests for the sweep. [review G8]
 *
 * Removing the `isNotNull(profile_id)` filter took this from "polls ~0
 * accounts" to "polls every account", so the concurrency cap and the
 * per-account backoff are load-bearing, not decoration.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

const accounts: { id: string; userId: string; profileId: string | null }[] = [];

vi.mock("@/db", () => ({
  db: { query: { claudeAccounts: { findMany: vi.fn(async () => accounts) } } },
}));

interface PollTarget {
  accountId: string;
  userId: string;
  profileId: string | null;
}

const fetchLimitState = vi.fn<(target: PollTarget) => Promise<unknown>>();
const trackExecute =
  vi.fn<(input: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@/infrastructure/container", () => ({
  usageLimitGateway: {
    fetchLimitState: (target: PollTarget) => fetchLimitState(target),
  },
  trackUsageLimitUseCase: {
    execute: (input: Record<string, unknown>) => trackExecute(input),
  },
}));

const pollEnabled = { value: true };
vi.mock("./poll-config", () => ({
  isUsagePollEnabled: () => pollEnabled.value,
}));

import { db } from "@/db";
import { runUsagePollSweep, resetUsagePollBackoff } from "./usage-poll-sweep";

const findMany = db.query.claudeAccounts.findMany as Mock;

function seedAccounts(n: number): void {
  accounts.length = 0;
  for (let i = 0; i < n; i += 1) {
    accounts.push({ id: `acct-${i}`, userId: "u1", profileId: null });
  }
}

function makeResult(accountId: string) {
  return {
    accountId,
    isLimited: false,
    resetAt5h: null,
    resetAt7d: null,
    window5hPct: 10,
    window7dPct: null,
    source: "poller" as const,
    windows: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pollEnabled.value = true;
  resetUsagePollBackoff();
  seedAccounts(3);
  trackExecute.mockResolvedValue({});
  fetchLimitState.mockImplementation(async (t) => makeResult(t.accountId));
});

describe("runUsagePollSweep", () => {
  it("is a no-op that never touches the DB when the poller is disabled", async () => {
    pollEnabled.value = false;

    await runUsagePollSweep();

    expect(findMany).not.toHaveBeenCalled();
    expect(fetchLimitState).not.toHaveBeenCalled();
  });

  it("polls accounts with NO origin profile (the n4x4.6 normal case)", async () => {
    await runUsagePollSweep();

    expect(fetchLimitState).toHaveBeenCalledTimes(3);
    expect(trackExecute).toHaveBeenCalledTimes(3);
  });

  it("passes the per-window detail through to the use case", async () => {
    await runUsagePollSweep();

    expect(trackExecute.mock.calls[0]?.[0]).toMatchObject({
      source: "poller",
      windows: [],
    });
  });

  it("never exceeds the concurrency cap", async () => {
    seedAccounts(20);
    let inFlight = 0;
    let peak = 0;
    fetchLimitState.mockImplementation(async (t) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return makeResult(t.accountId);
    });

    await runUsagePollSweep();

    expect(fetchLimitState).toHaveBeenCalledTimes(20);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // genuinely concurrent, not serial
  });

  it("backs a failing account off instead of retrying it every sweep", async () => {
    // A revoked token used to be retried forever, once per sweep.
    fetchLimitState.mockImplementation(async (t) =>
      t.accountId === "acct-1" ? null : makeResult(t.accountId)
    );

    await runUsagePollSweep();
    expect(fetchLimitState).toHaveBeenCalledTimes(3);

    vi.clearAllMocks();
    fetchLimitState.mockImplementation(async (t) =>
      t.accountId === "acct-1" ? null : makeResult(t.accountId)
    );

    await runUsagePollSweep();

    // acct-1 is inside its backoff interval and is skipped.
    const polledIds = fetchLimitState.mock.calls.map((c) => c[0].accountId);
    expect(polledIds).not.toContain("acct-1");
    expect(polledIds).toHaveLength(2);
  });

  it("backs off an account whose poll THROWS", async () => {
    fetchLimitState.mockImplementation(async (t) => {
      if (t.accountId === "acct-2") throw new Error("boom");
      return makeResult(t.accountId);
    });

    await runUsagePollSweep();
    vi.clearAllMocks();
    fetchLimitState.mockImplementation(async (t) =>
      makeResult(t.accountId)
    );

    await runUsagePollSweep();

    const polledIds = fetchLimitState.mock.calls.map((c) => c[0].accountId);
    expect(polledIds).not.toContain("acct-2");
  });

  it("a success clears any accumulated backoff", async () => {
    fetchLimitState.mockResolvedValueOnce(null); // acct-0 fails once
    await runUsagePollSweep();

    resetUsagePollBackoff(); // simulate the interval elapsing
    vi.clearAllMocks();
    fetchLimitState.mockImplementation(async (t) =>
      makeResult(t.accountId)
    );

    await runUsagePollSweep();
    expect(fetchLimitState).toHaveBeenCalledTimes(3);

    // …and with all three succeeding, the next sweep polls all three again.
    vi.clearAllMocks();
    fetchLimitState.mockImplementation(async (t) =>
      makeResult(t.accountId)
    );
    await runUsagePollSweep();
    expect(fetchLimitState).toHaveBeenCalledTimes(3);
  });

  it("never throws when the account query fails", async () => {
    findMany.mockRejectedValueOnce(new Error("db down"));

    await expect(runUsagePollSweep()).resolves.toBeUndefined();
  });
});
