// @vitest-environment node
/**
 * Pacing tests for the sweep. [review G8]
 *
 * Removing the `isNotNull(profile_id)` filter took this from "polls ~0
 * accounts" to "polls every account", so the concurrency cap and the
 * per-account backoff are load-bearing, not decoration.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

const accounts: {
  id: string;
  userId: string;
  profileId: string | null;
  usageOauthRefreshEncrypted: string | null;
}[] = [];

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
const { logDebug, logInfo, logWarn, logError } = vi.hoisted(() => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/infrastructure/container", () => ({
  usageLimitGateway: {
    fetchLimitState: (target: PollTarget) => fetchLimitState(target),
  },
  trackUsageLimitUseCase: {
    execute: (input: Record<string, unknown>) => trackExecute(input),
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: logDebug,
    info: logInfo,
    warn: logWarn,
    error: logError,
  }),
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
    accounts.push({
      id: `acct-${i}`,
      userId: "u1",
      profileId: null,
      usageOauthRefreshEncrypted: "encrypted-refresh-fixture",
    });
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

/** The gateway's typed 429 signal. [remote-dev-u7df] */
function rateLimitedResult(accountId: string, retryAt: Date) {
  return { rateLimited: true as const, accountId, retryAt };
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
    expect(logInfo).toHaveBeenCalledWith("Usage poll sweep complete", {
      polled: 3,
      recorded: 3,
      failed: 0,
      rateLimited: 0,
      skipped: 0,
      noCredential: 0,
    });
  });

  it("skips and separately counts accounts without a usage credential", async () => {
    accounts[1].usageOauthRefreshEncrypted = null;

    await runUsagePollSweep();

    expect(findMany).toHaveBeenCalledWith({
      columns: {
        id: true,
        userId: true,
        profileId: true,
        usageOauthRefreshEncrypted: true,
      },
    });
    const polledIds = fetchLimitState.mock.calls.map((call) => call[0].accountId);
    expect(polledIds).toEqual(["acct-0", "acct-2"]);
    expect(logWarn).toHaveBeenCalledWith("Usage poll sweep complete", {
      polled: 2,
      recorded: 2,
      failed: 0,
      rateLimited: 0,
      skipped: 0,
      noCredential: 1,
    });
  });

  it("polls a previously credential-less account immediately once a credential appears", async () => {
    seedAccounts(1);
    accounts[0].usageOauthRefreshEncrypted = null;

    await runUsagePollSweep();
    expect(fetchLimitState).not.toHaveBeenCalled();

    accounts[0].usageOauthRefreshEncrypted = "encrypted-refresh-fixture";
    await runUsagePollSweep();

    expect(fetchLimitState).toHaveBeenCalledTimes(1);
    expect(fetchLimitState).toHaveBeenCalledWith({
      accountId: "acct-0",
      userId: "u1",
      profileId: null,
    });
  });

  it("uses strict non-null presence semantics for the usage refresh credential", async () => {
    seedAccounts(1);
    accounts[0].usageOauthRefreshEncrypted = "";

    await runUsagePollSweep();

    expect(fetchLimitState).toHaveBeenCalledTimes(1);
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
    expect(logWarn).toHaveBeenCalledWith("Usage poll sweep complete", {
      polled: 3,
      recorded: 2,
      failed: 1,
      rateLimited: 0,
      skipped: 0,
      noCredential: 0,
    });

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

  describe("rate-limited scheduling [remote-dev-u7df]", () => {
    // The endpoint can still return 429; retry-after names the reset, so the
    // sweep must schedule the next attempt just past it (+30-90s jitter)
    // instead of walking the exponential backoff ladder.
    const T0 = new Date("2026-08-03T10:00:00Z").getTime();

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(T0);
      // Deterministic jitter: 30s + 0.5 * 60s = exactly 60s past the reset.
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      seedAccounts(1);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.mocked(Math.random).mockRestore();
    });

    it("schedules the next attempt at retryAt + jitter, not exponential backoff", async () => {
      const retryAt = new Date(T0 + 3_578_000); // observed retry-after: 3578s
      fetchLimitState.mockResolvedValue(rateLimitedResult("acct-0", retryAt));

      await runUsagePollSweep();
      expect(fetchLimitState).toHaveBeenCalledTimes(1);
      expect(trackExecute).not.toHaveBeenCalled(); // no observation to record

      // Inside the hold (reset + 59s < reset + 60s jitter): skipped.
      vi.setSystemTime(retryAt.getTime() + 59_000);
      fetchLimitState.mockClear();
      await runUsagePollSweep();
      expect(fetchLimitState).not.toHaveBeenCalled();

      // Just past the hold: polled again.
      vi.setSystemTime(retryAt.getTime() + 61_000);
      await runUsagePollSweep();
      expect(fetchLimitState).toHaveBeenCalledTimes(1);
    });

    it("repeated 429s stay aligned to each reset instead of escalating", async () => {
      // Exponential backoff would be at 20m/40m by round three; retry-after
      // alignment keeps every wait at reset + jitter.
      for (let round = 0; round < 3; round += 1) {
        const retryAt = new Date(Date.now() + 100_000);
        fetchLimitState.mockClear();
        fetchLimitState.mockResolvedValue(
          rateLimitedResult("acct-0", retryAt)
        );

        await runUsagePollSweep();
        expect(fetchLimitState).toHaveBeenCalledTimes(1);

        vi.setSystemTime(retryAt.getTime() + 61_000);
      }
    });

    it("does not escalate consecutiveFailures on a 429", async () => {
      // 429 first…
      const retryAt = new Date(T0 + 100_000);
      fetchLimitState.mockResolvedValue(rateLimitedResult("acct-0", retryAt));
      await runUsagePollSweep();

      // …then a genuine failure once the hold expires. If the 429 had counted
      // as a failure this would be the SECOND consecutive failure (20m); it
      // must be the first (10m).
      vi.setSystemTime(retryAt.getTime() + 61_000);
      fetchLimitState.mockClear();
      fetchLimitState.mockResolvedValue(null);
      await runUsagePollSweep();
      expect(fetchLimitState).toHaveBeenCalledTimes(1);
      const failedAt = Date.now();

      // 10m + 1s later the account is due again (a second-failure 20m backoff
      // would still be holding it).
      vi.setSystemTime(failedAt + 10 * 60 * 1000 + 1_000);
      fetchLimitState.mockClear();
      fetchLimitState.mockImplementation(async (t) =>
        makeResult(t.accountId)
      );
      await runUsagePollSweep();
      expect(fetchLimitState).toHaveBeenCalledTimes(1);
    });

    it("clamps a stale retryAt in the past to now + jitter", async () => {
      const retryAt = new Date(T0 - 60_000); // already elapsed
      fetchLimitState.mockResolvedValue(rateLimitedResult("acct-0", retryAt));
      await runUsagePollSweep();

      // Hold is now + 60s jitter, not instantly retryable and not in the past.
      vi.setSystemTime(T0 + 59_000);
      fetchLimitState.mockClear();
      await runUsagePollSweep();
      expect(fetchLimitState).not.toHaveBeenCalled();

      vi.setSystemTime(T0 + 61_000);
      await runUsagePollSweep();
      expect(fetchLimitState).toHaveBeenCalledTimes(1);
    });
  });
});
