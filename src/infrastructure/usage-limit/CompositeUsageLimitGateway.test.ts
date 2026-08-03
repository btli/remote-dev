// @vitest-environment node
/**
 * These tests exist because of a bug that made the ENTIRE proactive usage-poll
 * feature a runtime no-op while every other test passed. [review G1]
 *
 * Dispatch was `adapters.find(a => a.supports(kind))` — first match wins. The
 * container registers `[ReactiveOutputDetector, UsageEndpointPoller]`, and the
 * reactive detector's `supports("subscription")` returns true unconditionally
 * while its `fetchLimitState()` ALWAYS returns null (reactive observations
 * arrive via `/internal/usage-limit`, not by polling). So for every
 * subscription account the composite picked the reactive stub, got null, and
 * the poller was never invoked. The poller's own tests passed because they
 * instantiate it directly — nothing exercised dispatch.
 *
 * The load-bearing assertion is "a subscription-kind fetch reaches the second
 * adapter". Everything else here guards its edges.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/db", () => ({
  db: { query: { claudeAccounts: { findFirst: vi.fn() } } },
}));

vi.mock("@/db/schema", () => ({ claudeAccounts: { id: "id" } }));

import { db } from "@/db";
import { CompositeUsageLimitGateway } from "./CompositeUsageLimitGateway";
import { ReactiveOutputDetector } from "./ReactiveOutputDetector";
import type {
  UsageLimitGateway,
  LimitDetectionResult,
  UsageLimitRateLimited,
  UsageLimitTarget,
} from "@/application/ports/UsageLimitGateway";
import type { ClaudeAccountKind } from "@/types/claude-limits";

const accountFindFirst = db.query.claudeAccounts.findFirst as Mock;

const TARGET: UsageLimitTarget = {
  accountId: "acct-1",
  userId: "u1",
  profileId: null,
};

function makeResult(): LimitDetectionResult {
  return {
    accountId: "acct-1",
    isLimited: false,
    resetAt5h: null,
    resetAt7d: null,
    window5hPct: 42,
    window7dPct: null,
    source: "poller",
    windows: [],
  };
}

/** A stand-in for the poller: supports subscription and actually answers. */
class AnsweringAdapter implements UsageLimitGateway {
  readonly fetch = vi.fn(async (_target: UsageLimitTarget) => makeResult());
  constructor(private readonly kinds: ClaudeAccountKind[] = ["subscription"]) {}
  supports(kind: ClaudeAccountKind): boolean {
    return this.kinds.includes(kind);
  }
  async fetchLimitState(
    target: UsageLimitTarget
  ): Promise<LimitDetectionResult | null> {
    return this.fetch(target);
  }
}

/** An adapter whose upstream is rate-limited (429 + retry-after). */
class RateLimitedAdapter implements UsageLimitGateway {
  readonly signal: UsageLimitRateLimited;
  constructor(retryAt: Date) {
    this.signal = { rateLimited: true, accountId: "acct-1", retryAt };
  }
  supports(): boolean {
    return true;
  }
  async fetchLimitState(): Promise<UsageLimitRateLimited> {
    return this.signal;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  accountFindFirst.mockResolvedValue({ accountKind: "subscription" });
});

describe("CompositeUsageLimitGateway dispatch", () => {
  it("REACHES a later adapter when an earlier supporting one returns null", async () => {
    // The regression test for G1, using the real ReactiveOutputDetector so this
    // stays honest if its supports() ever changes.
    const poller = new AnsweringAdapter();
    const composite = new CompositeUsageLimitGateway([
      new ReactiveOutputDetector(),
      poller,
    ]);

    const result = await composite.fetchLimitState(TARGET);

    expect(poller.fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual(makeResult());
  });

  it("confirms the precondition: the reactive detector supports subscription but never answers", async () => {
    // If either half of this stops being true the test above stops proving
    // anything, so pin both.
    const reactive = new ReactiveOutputDetector();
    expect(reactive.supports("subscription")).toBe(true);
    await expect(reactive.fetchLimitState()).resolves.toBeNull();
  });

  it("stops at the FIRST adapter that produces an observation", async () => {
    const first = new AnsweringAdapter();
    const second = new AnsweringAdapter();
    const composite = new CompositeUsageLimitGateway([first, second]);

    await composite.fetchLimitState(TARGET);

    expect(first.fetch).toHaveBeenCalledTimes(1);
    expect(second.fetch).not.toHaveBeenCalled();
  });

  it("returns null when every supporting adapter declines", async () => {
    const composite = new CompositeUsageLimitGateway([
      new ReactiveOutputDetector(),
    ]);

    await expect(composite.fetchLimitState(TARGET)).resolves.toBeNull();
  });

  it("a rate-limited signal does not veto a later adapter's real observation", async () => {
    // [remote-dev-u7df] Rate-limited is weaker than an observation: keep
    // trying, and only fall back to the signal when nothing answers.
    const rateLimited = new RateLimitedAdapter(new Date(Date.now() + 60_000));
    const poller = new AnsweringAdapter();
    const composite = new CompositeUsageLimitGateway([rateLimited, poller]);

    const result = await composite.fetchLimitState(TARGET);

    expect(poller.fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual(makeResult());
  });

  it("returns the rate-limited signal when no adapter produces an observation", async () => {
    const retryAt = new Date(Date.now() + 3_578_000);
    const composite = new CompositeUsageLimitGateway([
      new ReactiveOutputDetector(),
      new RateLimitedAdapter(retryAt),
    ]);

    const result = await composite.fetchLimitState(TARGET);

    expect(result).toEqual({
      rateLimited: true,
      accountId: "acct-1",
      retryAt,
    });
  });

  it("skips adapters that do not support the kind", async () => {
    accountFindFirst.mockResolvedValue({ accountKind: "api_key" });
    const subscriptionOnly = new AnsweringAdapter(["subscription"]);
    const composite = new CompositeUsageLimitGateway([subscriptionOnly]);

    const result = await composite.fetchLimitState(TARGET);

    expect(result).toBeNull();
    expect(subscriptionOnly.fetch).not.toHaveBeenCalled();
  });

  it("resolves the account kind by account id, not by profile id", async () => {
    // [remote-dev-n4x4.4] profile_id has been a nullable, NON-unique origin
    // breadcrumb since n4x4.6, so a standalone account resolved to no row.
    const poller = new AnsweringAdapter();
    const composite = new CompositeUsageLimitGateway([poller]);

    await composite.fetchLimitState(TARGET);

    expect(accountFindFirst).toHaveBeenCalledTimes(1);
    expect(poller.fetch).toHaveBeenCalledWith(TARGET);
  });

  it("defaults an account with no row to subscription", async () => {
    accountFindFirst.mockResolvedValue(undefined);
    const poller = new AnsweringAdapter();
    const composite = new CompositeUsageLimitGateway([poller]);

    await expect(composite.fetchLimitState(TARGET)).resolves.toEqual(
      makeResult()
    );
  });

  it("returns null for an unrecognized stored kind (no gateway)", async () => {
    accountFindFirst.mockResolvedValue({ accountKind: "wat" });
    const poller = new AnsweringAdapter();
    const composite = new CompositeUsageLimitGateway([poller]);

    await expect(composite.fetchLimitState(TARGET)).resolves.toBeNull();
    expect(poller.fetch).not.toHaveBeenCalled();
  });
});
