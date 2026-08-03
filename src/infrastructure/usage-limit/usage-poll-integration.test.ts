// @vitest-environment node
/**
 * Integration test across the REAL wiring: composite → poller → adapter.
 *
 * Requested by review as the end-to-end confirmation for the G1 × G7
 * interaction. Two independent defects each made the feature a silent no-op,
 * and each unit test suite passed anyway:
 *
 *   - G1: first-match dispatch meant the always-null reactive stub shadowed the
 *     poller for every subscription account.
 *   - G7: the poller now requires an explicit positive flag value.
 *
 * Only exercising them together, through the container's actual adapter
 * ordering, proves the feature runs. Everything is real except the HTTP call,
 * the DB, and the credential read.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const FLAG = "RDV_CLAUDE_USAGE_POLL_ENABLED";
const originalFlag = process.env[FLAG];

vi.mock("@/db", () => ({
  db: {
    query: {
      claudeAccounts: {
        findFirst: vi.fn(async () => ({ accountKind: "subscription" })),
      },
    },
  },
}));
vi.mock("@/db/schema", () => ({ claudeAccounts: { id: "id" } }));

const fetchClaudeUsage = vi.fn();
vi.mock("@/infrastructure/external/anthropic-usage-adapter", () => ({
  fetchClaudeUsage: (token: string, kind: string) =>
    fetchClaudeUsage(token, kind),
}));

import { CompositeUsageLimitGateway } from "./CompositeUsageLimitGateway";
import { ReactiveOutputDetector } from "./ReactiveOutputDetector";
import { UsageEndpointPoller } from "./UsageEndpointPoller";
import { isUsagePollEnabled } from "./poll-config";

const TARGET = { accountId: "acct-1", userId: "u1", profileId: null };

/** Exactly the container's registration order — that ordering IS the bug. */
function containerShapedGateway(): CompositeUsageLimitGateway {
  return new CompositeUsageLimitGateway([
    new ReactiveOutputDetector(),
    new UsageEndpointPoller(async () => "test-account-token"),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env[FLAG] = "1";
});

afterAll(() => {
  if (originalFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = originalFlag;
});

describe("usage poll: end-to-end through the real wiring", () => {
  it("with the flag ON, a subscription fetch reaches the poller and yields per-model windows", async () => {
    expect(isUsagePollEnabled()).toBe(true);
    const reset = new Date("2026-08-09T00:00:00Z");
    fetchClaudeUsage.mockResolvedValue({
      outcome: "snapshot",
      snapshot: {
        window5hPct: 61,
        window7dPct: 98,
        resetAt5h: null,
        resetAt7d: null,
        orgPct: null,
        resetAtOrg: null,
        limits: [
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 100,
            severity: "critical",
            resetAt: reset,
            scopeModel: "Fable",
            scopeSurface: null,
            isActive: true,
          },
        ],
      },
    });

    const result = await containerShapedGateway().fetchLimitState(TARGET);

    // The HTTP read actually happened — this is what G1 prevented.
    expect(fetchClaudeUsage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      source: "poller",
      // The account is NOT limited overall, but the per-model window rode out:
      // exactly the live scenario the epic exists for.
      isLimited: false,
      window7dPct: 98,
      windows: [
        {
          kind: "weekly_scoped",
          scopeModel: "Fable",
          severity: "critical",
          resetsAt: reset,
          isActive: true,
        },
      ],
    });
  });

  it("with the flag ON, a 429'd fetch surfaces the typed rate-limited signal", async () => {
    // [remote-dev-u7df] End-to-end: adapter 429 outcome → poller signal →
    // composite fallback return. This is what the sweep schedules from.
    const retryAt = new Date(Date.now() + 3_578_000);
    fetchClaudeUsage.mockResolvedValue({ outcome: "rate-limited", retryAt });

    const result = await containerShapedGateway().fetchLimitState(TARGET);

    expect(fetchClaudeUsage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      rateLimited: true,
      accountId: "acct-1",
      retryAt,
    });
  });

  it("with the flag OFF, nothing is polled and no request is made", async () => {
    process.env[FLAG] = "0";
    expect(isUsagePollEnabled()).toBe(false);

    const result = await containerShapedGateway().fetchLimitState(TARGET);

    expect(result).toBeNull();
    expect(fetchClaudeUsage).not.toHaveBeenCalled();
  });

  it("with the flag UNSET, nothing is polled (opt-in, not opt-out)", async () => {
    delete process.env[FLAG];
    expect(isUsagePollEnabled()).toBe(false);

    const result = await containerShapedGateway().fetchLimitState(TARGET);

    expect(result).toBeNull();
    expect(fetchClaudeUsage).not.toHaveBeenCalled();
  });
});
