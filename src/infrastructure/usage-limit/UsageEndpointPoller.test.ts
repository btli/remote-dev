// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (declared before importing the SUT) ──────────────────────────────

vi.mock("@/db", () => ({
  db: {
    query: {
      claudeAccounts: { findFirst: vi.fn() },
    },
  },
}));

vi.mock("@/db/schema", () => ({
  claudeAccounts: { id: "id" },
}));

vi.mock("@/infrastructure/external/anthropic-usage-adapter", () => ({
  fetchClaudeUsage: vi.fn(),
}));

vi.mock("@/infrastructure/external/anthropic-oauth-refresh", () => ({
  getFreshUsageAccessToken: vi.fn(),
}));

vi.mock("@/services/claude-account-service", () => ({
  CLAUDE_OAUTH_TOKEN_ENV: "CLAUDE_CODE_OAUTH_TOKEN",
  resolveAccountEnv: vi.fn(),
}));

const pollEnabled = { value: true };
vi.mock("./poll-config", () => ({
  isUsagePollEnabled: () => pollEnabled.value,
}));

import { db } from "@/db";
import { fetchClaudeUsage } from "@/infrastructure/external/anthropic-usage-adapter";
import { getFreshUsageAccessToken } from "@/infrastructure/external/anthropic-oauth-refresh";
import { resolveAccountEnv } from "@/services/claude-account-service";
import {
  isUsageLimitRateLimited,
  type LimitDetectionResult,
  type UsageLimitRateLimited,
} from "@/application/ports/UsageLimitGateway";
import {
  UsageEndpointPoller,
  usageSnapshotToLimitDetectionResult,
} from "./UsageEndpointPoller";

const claudeAccountsFindFirst = db.query.claudeAccounts.findFirst as ReturnType<
  typeof vi.fn
>;
const fetchUsageMock = fetchClaudeUsage as unknown as ReturnType<typeof vi.fn>;
const getFreshUsageAccessTokenMock = getFreshUsageAccessToken as ReturnType<
  typeof vi.fn
>;
const resolveAccountEnvMock = resolveAccountEnv as ReturnType<typeof vi.fn>;

/**
 * Stand-in for the account→credential resolution. Never a real token shape —
 * fixtures must not carry anything that resembles a credential.
 */
const TOKEN = "test-account-token";
let tokenReader: ReturnType<typeof vi.fn>;

const TARGET = { accountId: "acct-1", userId: "u1", profileId: null };

/** Adapter snapshot with null rollup fields; override what a case cares about. */
function makeSnapshot(
  over: {
    window5hPct?: number | null;
    window7dPct?: number | null;
    resetAt5h?: Date | null;
    resetAt7d?: Date | null;
    orgPct?: number | null;
    resetAtOrg?: Date | null;
    limits?: Array<{
      kind: string;
      group: string | null;
      percent: number;
      severity: string | null;
      resetAt: Date | null;
      scopeModel: string | null;
      scopeSurface: string | null;
      isActive: boolean;
    }>;
  } = {}
) {
  return {
    window5hPct: null as number | null,
    window7dPct: null as number | null,
    resetAt5h: null as Date | null,
    resetAt7d: null as Date | null,
    orgPct: null as number | null,
    resetAtOrg: null as Date | null,
    limits: [] as NonNullable<(typeof over)["limits"]>,
    ...over,
  };
}

/** Wrap a snapshot in the adapter's discriminated fetch outcome. */
function ok(snapshot: ReturnType<typeof makeSnapshot>) {
  return { outcome: "snapshot" as const, snapshot };
}

/** Narrow a fetch result to an observation (fails the test otherwise). */
function asObservation(
  result: LimitDetectionResult | UsageLimitRateLimited | null
): LimitDetectionResult | null {
  if (result !== null && isUsageLimitRateLimited(result)) {
    throw new Error("expected an observation, got a rate-limited signal");
  }
  return result;
}

function makePoller(): UsageEndpointPoller {
  return new UsageEndpointPoller(
    tokenReader as unknown as (
      accountId: string,
      userId: string
    ) => Promise<string | null>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pollEnabled.value = true;
  tokenReader = vi.fn().mockResolvedValue(TOKEN);
  getFreshUsageAccessTokenMock.mockResolvedValue(TOKEN);
});

describe("UsageEndpointPoller.supports", () => {
  it("supports subscription only when the flag is on (the usage endpoint is OAuth-only)", () => {
    const poller = makePoller();
    expect(poller.supports("subscription")).toBe(true);
    expect(poller.supports("api_key")).toBe(false);
  });

  it("supports nothing when the flag is off", () => {
    pollEnabled.value = false;
    const poller = makePoller();
    expect(poller.supports("subscription")).toBe(false);
    expect(poller.supports("api_key")).toBe(false);
  });
});

describe("usageSnapshotToLimitDetectionResult", () => {
  it("purely normalizes an already-validated snapshot for immediate persistence", () => {
    const reset5h = new Date("2026-08-03T12:00:00Z");
    const scopedReset = new Date("2026-08-09T00:00:00Z");

    const result = usageSnapshotToLimitDetectionResult(
      "acct-captured",
      makeSnapshot({
        window5hPct: 100,
        window7dPct: 45,
        resetAt5h: reset5h,
        limits: [
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 82,
            severity: "elevated",
            resetAt: scopedReset,
            scopeModel: "Mythos",
            scopeSurface: "code",
            isActive: true,
          },
        ],
      })
    );

    expect(result).toEqual({
      accountId: "acct-captured",
      isLimited: true,
      resetAt5h: reset5h,
      resetAt7d: null,
      window5hPct: 100,
      window7dPct: 45,
      source: "poller",
      windows: [
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 82,
          severity: "elevated",
          resetsAt: scopedReset,
          scopeModel: "Mythos",
          scopeSurface: "code",
          isActive: true,
        },
      ],
    });
  });
});

describe("UsageEndpointPoller.fetchLimitState", () => {
  it("returns null immediately when the flag is off (no DB/network)", async () => {
    pollEnabled.value = false;
    const poller = makePoller();

    const result = await poller.fetchLimitState(TARGET);

    expect(result).toBeNull();
    expect(claudeAccountsFindFirst).not.toHaveBeenCalled();
    expect(tokenReader).not.toHaveBeenCalled();
    expect(fetchUsageMock).not.toHaveBeenCalled();
  });

  describe("subscription", () => {
    it("uses only the fresh independent usage credential by default", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      fetchUsageMock.mockResolvedValue(
        ok(makeSnapshot({ window5hPct: 20, window7dPct: 30 }))
      );

      await new UsageEndpointPoller().fetchLimitState(TARGET);

      expect(getFreshUsageAccessTokenMock).toHaveBeenCalledWith("acct-1", "u1");
      expect(resolveAccountEnvMock).not.toHaveBeenCalled();
      expect(fetchUsageMock).toHaveBeenCalledWith(TOKEN, "subscription");
    });

    it("reads the ACCOUNT's decrypted token, probes, and maps the 5h/7d snapshot", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      const reset5h = new Date("2025-06-13T15:00:00Z");
      fetchUsageMock.mockResolvedValue(
        ok(
          makeSnapshot({
            window5hPct: 80,
            window7dPct: 40,
            resetAt5h: reset5h,
          })
        )
      );

      const poller = makePoller();
      const result = await poller.fetchLimitState(TARGET);

      // The injected seam stands in for the account's independent usage OAuth
      // credential; session setup-token resolution is deliberately separate.
      expect(tokenReader).toHaveBeenCalledWith("acct-1", "u1");
      expect(fetchUsageMock).toHaveBeenCalledWith(TOKEN, "subscription");
      expect(result).toEqual({
        accountId: "acct-1",
        isLimited: false,
        resetAt5h: reset5h,
        resetAt7d: null,
        window5hPct: 80,
        window7dPct: 40,
        source: "poller",
        windows: [],
      });
    });

    it("marks limited when a window is at/over 100%", async () => {
      claudeAccountsFindFirst.mockResolvedValue(undefined); // absent → subscription
      fetchUsageMock.mockResolvedValue(
        ok(makeSnapshot({ window5hPct: 100, window7dPct: 50 }))
      );

      const poller = makePoller();
      const result = asObservation(await poller.fetchLimitState(TARGET));

      expect(result?.isLimited).toBe(true);
    });

    it("returns null (no probe) when the account has no usable credential", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      tokenReader.mockResolvedValue(null);

      const poller = makePoller();
      const result = await poller.fetchLimitState(TARGET);

      expect(result).toBeNull();
      expect(fetchUsageMock).not.toHaveBeenCalled();
    });

    it("returns null when the adapter reports no data", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      fetchUsageMock.mockResolvedValue({ outcome: "no-data" });

      const poller = makePoller();
      const result = await poller.fetchLimitState(TARGET);

      expect(result).toBeNull();
    });

    it("returns null when the usage credential is forbidden", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      fetchUsageMock.mockResolvedValue({ outcome: "forbidden" });

      const result = await makePoller().fetchLimitState(TARGET);

      expect(result).toBeNull();
    });

    it("passes a rate-limited outcome through as a typed signal, not null", async () => {
      // [remote-dev-u7df] The 429's retry-after is the only thing that names
      // the retry instant — it must reach the sweep, which schedules the next
      // attempt from it instead of exponential backoff.
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      const retryAt = new Date(Date.now() + 3578_000);
      fetchUsageMock.mockResolvedValue({ outcome: "rate-limited", retryAt });

      const poller = makePoller();
      const result = await poller.fetchLimitState(TARGET);

      expect(result).toEqual({
        rateLimited: true,
        accountId: "acct-1",
        retryAt,
      });
    });
  });

  describe("api_key", () => {
    it("returns null without reading — the usage endpoint is subscription-only", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "api_key" });

      const poller = makePoller();
      const result = await poller.fetchLimitState(TARGET);

      expect(result).toBeNull();
      // No credential resolution and no HTTP read for api_key.
      expect(tokenReader).not.toHaveBeenCalled();
      expect(fetchUsageMock).not.toHaveBeenCalled();
    });

    it("folds an org-dimension snapshot into the 5h slot when given one", async () => {
      // Drive the mapping directly: an api_key-shaped snapshot (org only) maps
      // its org pct/reset onto the result's 5h slot. (The poller's own api_key
      // credential path is not yet wired, so we exercise the mapping via a
      // subscription-kind probe returning an org-only snapshot.)
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      const orgReset = new Date("2025-06-13T16:00:00Z");
      fetchUsageMock.mockResolvedValue(
        ok(makeSnapshot({ orgPct: 100, resetAtOrg: orgReset }))
      );

      const poller = makePoller();
      const result = asObservation(await poller.fetchLimitState(TARGET));

      expect(result?.window5hPct).toBe(100);
      expect(result?.resetAt5h).toBe(orgReset);
      expect(result?.isLimited).toBe(true);
    });
  });

  it("passes a per-model scoped limit through without disturbing the 5h/7d rollup", async () => {
    claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
    const scopedReset = new Date("2026-07-30T22:59:59Z");
    fetchUsageMock.mockResolvedValue(
      ok(
        makeSnapshot({
          window5hPct: 61,
          window7dPct: 98,
          limits: [
            {
              kind: "weekly_scoped",
              group: "weekly",
              percent: 100,
              severity: "critical",
              resetAt: scopedReset,
              scopeModel: "Fable",
              scopeSurface: null,
              isActive: true,
            },
          ],
        })
      )
    );

    const poller = makePoller();
    const result = asObservation(await poller.fetchLimitState(TARGET));

    // The account is NOT limited overall even though one model's window is
    // exhausted — that distinction is exactly the point of the epic.
    expect(result?.window5hPct).toBe(61);
    expect(result?.window7dPct).toBe(98);
    expect(result?.isLimited).toBe(false);

    // …and the scoped window rides out for persistence + model-aware selection.
    expect(result?.windows).toEqual([
      {
        kind: "weekly_scoped",
        group: "weekly",
        percent: 100,
        severity: "critical",
        resetsAt: scopedReset,
        scopeModel: "Fable",
        scopeSurface: null,
        isActive: true,
      },
    ]);
  });

  it("round-trips an unknown kind/severity verbatim (the vocabularies are open sets)", async () => {
    claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
    fetchUsageMock.mockResolvedValue(
      ok(
        makeSnapshot({
          window5hPct: 10,
          limits: [
            {
              kind: "monthly_scoped",
              group: "monthly",
              percent: 42,
              severity: "elevated",
              resetAt: null,
              scopeModel: "Mythos",
              scopeSurface: "code",
              isActive: false,
            },
          ],
        })
      )
    );

    const poller = makePoller();
    const result = asObservation(await poller.fetchLimitState(TARGET));

    expect(result?.windows[0]).toMatchObject({
      kind: "monthly_scoped",
      group: "monthly",
      severity: "elevated",
      scopeModel: "Mythos",
      scopeSurface: "code",
    });
  });

  it("never throws — a DB error resolves to null", async () => {
    claudeAccountsFindFirst.mockRejectedValue(new Error("db down"));

    const poller = makePoller();
    await expect(poller.fetchLimitState(TARGET)).resolves.toBeNull();
  });

  it("never leaks the token into the result", async () => {
    claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
    fetchUsageMock.mockResolvedValue(
      ok(makeSnapshot({ window5hPct: 5, window7dPct: 5 }))
    );

    const poller = makePoller();
    const result = await poller.fetchLimitState(TARGET);

    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
