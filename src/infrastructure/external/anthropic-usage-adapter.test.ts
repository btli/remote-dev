// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  apiKeyUsageFromHeaders,
  fetchClaudeUsage,
  type ClaudeUsageFetchResult,
  type ClaudeUsageSnapshot,
  type FetchLike,
} from "./anthropic-usage-adapter";

/**
 * Build a FetchLike returning the given status + raw body (+ optional response
 * headers, e.g. `retry-after`), recording the request it was called with (so we
 * can assert on credential headers without ever exposing the token elsewhere).
 * No live network calls anywhere here.
 */
function fakeFetch(
  status: number,
  body: string,
  headers: Record<string, string> = {}
): { fetch: FetchLike; calls: Array<Parameters<FetchLike>> } {
  const calls: Array<Parameters<FetchLike>> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push([url, init]);
    return { status, headers: new Headers(headers), text: async () => body };
  };
  return { fetch, calls };
}

function jsonFetch(payload: unknown, status = 200) {
  return fakeFetch(status, JSON.stringify(payload));
}

/** Unwrap a snapshot outcome; throws loudly when the outcome is anything else. */
function snapshotOf(result: ClaudeUsageFetchResult): ClaudeUsageSnapshot {
  if (result.outcome !== "snapshot") {
    throw new Error(`expected a snapshot outcome, got "${result.outcome}"`);
  }
  return result.snapshot;
}

/** The live shape verified against a Max subscription (2026-07-28). */
const LIVE_BODY = {
  five_hour: {
    utilization: 61.0,
    resets_at: "2026-07-28T14:40:00.280338+00:00",
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
  },
  seven_day: {
    utilization: 98.0,
    resets_at: "2026-07-30T22:59:59.280356+00:00",
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
  },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  seven_day_cowork: null,
  seven_day_omelette: null,
  extra_usage: {
    is_enabled: false,
    used_credits: 12137.0,
    utilization: null,
    disabled_reason: "out_of_credits",
  },
  limits: [
    {
      kind: "session",
      group: "session",
      percent: 61,
      severity: "normal",
      resets_at: "2026-07-28T14:40:00.280338+00:00",
      scope: null,
      is_active: false,
    },
    {
      kind: "weekly_all",
      group: "weekly",
      percent: 98,
      severity: "critical",
      resets_at: "2026-07-30T22:59:59.280356+00:00",
      scope: null,
      is_active: false,
    },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 100,
      severity: "critical",
      resets_at: "2026-07-30T23:00:00.280564+00:00",
      scope: { model: { id: null, display_name: "Fable" }, surface: null },
      is_active: true,
    },
  ],
};

describe("fetchClaudeUsage", () => {
  describe("request shape", () => {
    it("GETs /api/oauth/usage with Bearer + the oauth beta and a timeout signal", async () => {
      const { fetch, calls } = jsonFetch(LIVE_BODY);

      await fetchClaudeUsage("secret-oauth", "subscription", fetch);

      expect(calls).toHaveLength(1);
      const [url, init] = calls[0];
      expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
      expect(init.method).toBe("GET");
      expect(init.headers["authorization"]).toBe("Bearer secret-oauth");
      expect(init.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
      expect(init.headers["anthropic-version"]).toBe("2023-06-01");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("never issues a /v1/messages probe", async () => {
      const { fetch, calls } = jsonFetch(LIVE_BODY);
      await fetchClaudeUsage("tok", "subscription", fetch);
      for (const [url, init] of calls) {
        expect(url).not.toContain("/v1/messages");
        expect(init.method).toBe("GET");
        expect(init).not.toHaveProperty("body");
      }
    });

    it("defaults to subscription when no kind is given", async () => {
      const { fetch, calls } = jsonFetch(LIVE_BODY);
      await fetchClaudeUsage("tok", undefined, fetch);
      expect(calls[0][1].headers["authorization"]).toBe("Bearer tok");
    });
  });

  describe("guards", () => {
    it("returns no-data for an empty token without calling fetch", async () => {
      const { fetch, calls } = jsonFetch(LIVE_BODY);
      const result = await fetchClaudeUsage("", "subscription", fetch);
      expect(result.outcome).toBe("no-data");
      expect(calls).toHaveLength(0);
    });

    it("returns no-data for api_key without calling fetch (endpoint is subscription-only)", async () => {
      const { fetch, calls } = jsonFetch(LIVE_BODY);
      const result = await fetchClaudeUsage("sk-ant-key", "api_key", fetch);
      expect(result.outcome).toBe("no-data");
      expect(calls).toHaveLength(0);
    });

    it("returns no-data (best-effort) when fetch throws", async () => {
      const throwing: FetchLike = async () => {
        throw new Error("network down");
      };
      const result = await fetchClaudeUsage("tok", "subscription", throwing);
      expect(result.outcome).toBe("no-data");
    });
  });

  describe("limits[] present (primary path)", () => {
    it("maps every window, including the per-model weekly_scoped entry", async () => {
      const { fetch } = jsonFetch(LIVE_BODY);

      const snap = snapshotOf(
        await fetchClaudeUsage("tok", "subscription", fetch)
      );

      expect(snap.limits).toHaveLength(3);
      expect(snap.limits[2]).toEqual({
        kind: "weekly_scoped",
        group: "weekly",
        percent: 100,
        severity: "critical",
        resetAt: new Date("2026-07-30T23:00:00.280564+00:00"),
        // scope.model.id is null upstream — display_name is the identity.
        scopeModel: "Fable",
        scopeSurface: null,
        isActive: true,
      });
    });

    it("rolls up 5h from `session` and 7d from `weekly_all` (not the worst scoped window)", async () => {
      const { fetch } = jsonFetch(LIVE_BODY);

      const snap = snapshotOf(
        await fetchClaudeUsage("tok", "subscription", fetch)
      );

      expect(snap.window5hPct).toBe(61);
      expect(snap.window7dPct).toBe(98); // NOT 100 from the Fable scoped window
      expect(snap.resetAt5h?.toISOString()).toBe("2026-07-28T14:40:00.280Z");
      expect(snap.resetAt7d?.toISOString()).toBe("2026-07-30T22:59:59.280Z");
      expect(snap.orgPct).toBeNull();
      expect(snap.resetAtOrg).toBeNull();
    });

    it("ignores the legacy flat per-model fields entirely", async () => {
      // Legacy fields populated but contradicting limits[] — limits[] wins.
      const { fetch } = jsonFetch({
        ...LIVE_BODY,
        seven_day_opus: { utilization: 5.0, resets_at: null },
        seven_day_sonnet: { utilization: 7.0, resets_at: null },
      });

      const snap = snapshotOf(
        await fetchClaudeUsage("tok", "subscription", fetch)
      );

      expect(snap.window7dPct).toBe(98);
      expect(snap.limits.map((l) => l.kind)).toEqual([
        "session",
        "weekly_all",
        "weekly_scoped",
      ]);
    });

    it("round-trips unknown kind / severity / group values instead of crashing", async () => {
      const { fetch } = jsonFetch({
        limits: [
          {
            kind: "monthly_experimental",
            group: "monthly",
            percent: 42,
            severity: "elevated",
            resets_at: "2026-08-01T00:00:00Z",
            scope: { model: { id: null, display_name: "Mythos" }, surface: "cli" },
            is_active: false,
          },
        ],
      });

      const snap = snapshotOf(
        await fetchClaudeUsage("tok", "subscription", fetch)
      );

      expect(snap.limits[0].kind).toBe("monthly_experimental");
      expect(snap.limits[0].severity).toBe("elevated");
      expect(snap.limits[0].group).toBe("monthly");
      expect(snap.limits[0].scopeModel).toBe("Mythos");
      expect(snap.limits[0].scopeSurface).toBe("cli");
      // No session / weekly_all entry and no five_hour / seven_day fallback.
      expect(snap.window5hPct).toBeNull();
      expect(snap.window7dPct).toBeNull();
    });

    it("drops malformed entries (no usable kind) and defaults a missing percent to 0", async () => {
      const { fetch } = jsonFetch({
        limits: [
          "not-an-object",
          { group: "weekly" }, // no kind → dropped
          { kind: "   " }, // blank kind → dropped
          { kind: "session", is_active: true }, // no percent → 0
        ],
      });

      const snap = snapshotOf(
        await fetchClaudeUsage("tok", "subscription", fetch)
      );

      expect(snap.limits).toHaveLength(1);
      expect(snap.limits[0]).toEqual({
        kind: "session",
        group: null,
        percent: 0,
        severity: null,
        resetAt: null,
        scopeModel: null,
        scopeSurface: null,
        isActive: true,
      });
      expect(snap.window5hPct).toBe(0);
    });

    it("clamps and rounds percent into 0-100", async () => {
      const { fetch } = jsonFetch({
        limits: [
          { kind: "session", percent: 60.6 },
          { kind: "weekly_all", percent: 140 },
          { kind: "other", percent: -3 },
        ],
      });

      const snap = snapshotOf(
        await fetchClaudeUsage("tok", "subscription", fetch)
      );

      expect(snap.limits.map((l) => l.percent)).toEqual([61, 100, 0]);
    });
  });

  describe("limits[] absent (five_hour / seven_day fallback)", () => {
    it("falls back to the flat windows when limits[] is missing", async () => {
      const { fetch } = jsonFetch({
        five_hour: { utilization: 12.4, resets_at: "2026-07-28T14:40:00Z" },
        seven_day: { utilization: 77.5, resets_at: "2026-07-30T23:00:00Z" },
      });

      const snap = snapshotOf(
        await fetchClaudeUsage("tok", "subscription", fetch)
      );

      expect(snap.limits).toEqual([]);
      expect(snap.window5hPct).toBe(12);
      expect(snap.window7dPct).toBe(78);
      expect(snap.resetAt5h?.toISOString()).toBe("2026-07-28T14:40:00.000Z");
      expect(snap.resetAt7d?.toISOString()).toBe("2026-07-30T23:00:00.000Z");
    });

    it("falls back when limits[] is an empty array", async () => {
      const { fetch } = jsonFetch({
        limits: [],
        five_hour: { utilization: 5.0, resets_at: null },
        seven_day: null,
      });

      const snap = snapshotOf(
        await fetchClaudeUsage("tok", "subscription", fetch)
      );

      expect(snap.window5hPct).toBe(5);
      expect(snap.window7dPct).toBeNull();
    });

    it("fills only the dimensions limits[] did not supply", async () => {
      // A session entry but no weekly_all → 7d comes from seven_day.
      const { fetch } = jsonFetch({
        limits: [
          { kind: "session", percent: 30, resets_at: "2026-07-28T14:40:00Z" },
        ],
        seven_day: { utilization: 88.0, resets_at: "2026-07-30T23:00:00Z" },
      });

      const snap = snapshotOf(
        await fetchClaudeUsage("tok", "subscription", fetch)
      );

      expect(snap.window5hPct).toBe(30);
      expect(snap.window7dPct).toBe(88);
    });

    it("returns no-data when nothing usable is reported", async () => {
      const { fetch } = jsonFetch({
        limits: [],
        five_hour: null,
        seven_day: null,
        extra_usage: { is_enabled: false },
      });

      const result = await fetchClaudeUsage("tok", "subscription", fetch);
      expect(result.outcome).toBe("no-data");
    });
  });

  describe("HTTP 429 (rate limited)", () => {
    // [remote-dev-u7df] Anthropic throttles long-lived setup-token credentials
    // on this endpoint to ~1 request/hour; the 429's retry-after names the
    // reset and MUST survive to the caller instead of collapsing into no-data.
    it("surfaces rate-limited-until from an integer-seconds retry-after", async () => {
      const before = Date.now();
      const { fetch } = fakeFetch(429, "{}", { "retry-after": "3578" });

      const result = await fetchClaudeUsage("tok", "subscription", fetch);

      expect(result.outcome).toBe("rate-limited");
      if (result.outcome !== "rate-limited") throw new Error("unreachable");
      const at = result.retryAt.getTime();
      expect(at).toBeGreaterThanOrEqual(before + 3_577_000);
      expect(at).toBeLessThanOrEqual(Date.now() + 3_579_000);
    });

    it("surfaces rate-limited-until from an HTTP-date retry-after", async () => {
      const future = new Date(Date.now() + 30 * 60 * 1000);
      const { fetch } = fakeFetch(429, "{}", {
        "retry-after": future.toUTCString(),
      });

      const result = await fetchClaudeUsage("tok", "subscription", fetch);

      expect(result.outcome).toBe("rate-limited");
      if (result.outcome !== "rate-limited") throw new Error("unreachable");
      // toUTCString drops sub-second precision; allow the rounding.
      expect(
        Math.abs(result.retryAt.getTime() - future.getTime())
      ).toBeLessThanOrEqual(2_000);
    });

    it("falls back to no-data when retry-after is missing", async () => {
      const { fetch } = fakeFetch(429, "{}");
      const result = await fetchClaudeUsage("tok", "subscription", fetch);
      expect(result.outcome).toBe("no-data");
    });

    it("falls back to no-data when retry-after is garbage", async () => {
      const { fetch } = fakeFetch(429, "{}", { "retry-after": "soon-ish" });
      const result = await fetchClaudeUsage("tok", "subscription", fetch);
      expect(result.outcome).toBe("no-data");
    });

    it("falls back to no-data when the retry-after HTTP-date is in the past", async () => {
      const past = new Date(Date.now() - 60_000);
      const { fetch } = fakeFetch(429, "{}", {
        "retry-after": past.toUTCString(),
      });
      const result = await fetchClaudeUsage("tok", "subscription", fetch);
      expect(result.outcome).toBe("no-data");
    });
  });

  describe("failure paths", () => {
    it.each([401, 403, 500])("returns no-data on HTTP %i", async (status) => {
      const { fetch } = jsonFetch(LIVE_BODY, status);
      const result = await fetchClaudeUsage("tok", "subscription", fetch);
      expect(result.outcome).toBe("no-data");
    });

    it("returns no-data on malformed JSON", async () => {
      const { fetch } = fakeFetch(200, "{not json");
      const result = await fetchClaudeUsage("tok", "subscription", fetch);
      expect(result.outcome).toBe("no-data");
    });

    it("returns no-data on a non-object JSON body", async () => {
      const { fetch } = fakeFetch(200, "[1, 2, 3]");
      const result = await fetchClaudeUsage("tok", "subscription", fetch);
      expect(result.outcome).toBe("no-data");
    });

    it("returns no-data when reading the body throws", async () => {
      const fetch: FetchLike = async () => ({
        status: 200,
        headers: new Headers(),
        text: async () => {
          throw new Error("stream aborted");
        },
      });
      const result = await fetchClaudeUsage("tok", "subscription", fetch);
      expect(result.outcome).toBe("no-data");
    });
  });
});

describe("apiKeyUsageFromHeaders", () => {
  it("uses the worst-case utilization across rate families + soonest reset", () => {
    const soon = "2025-06-13T15:00:00Z";
    const later = "2025-06-13T16:00:00Z";
    const snap = apiKeyUsageFromHeaders(
      new Headers({
        // requests: 20% used
        "anthropic-ratelimit-requests-limit": "1000",
        "anthropic-ratelimit-requests-remaining": "800",
        "anthropic-ratelimit-requests-reset": later,
        // input-tokens: 90% used (the binding limit) — and the soonest reset
        "anthropic-ratelimit-input-tokens-limit": "100000",
        "anthropic-ratelimit-input-tokens-remaining": "10000",
        "anthropic-ratelimit-input-tokens-reset": soon,
        // output-tokens: 50% used
        "anthropic-ratelimit-output-tokens-limit": "20000",
        "anthropic-ratelimit-output-tokens-remaining": "10000",
        "anthropic-ratelimit-output-tokens-reset": later,
      })
    );

    expect(snap.orgPct).toBe(90);
    expect(snap.resetAtOrg?.toISOString()).toBe("2025-06-13T15:00:00.000Z");
    // Subscription dimensions stay null for an api_key read.
    expect(snap.window5hPct).toBeNull();
    expect(snap.window7dPct).toBeNull();
    expect(snap.resetAt5h).toBeNull();
    expect(snap.resetAt7d).toBeNull();
    expect(snap.limits).toEqual([]);
  });

  it("pins utilization to 100 and uses retry-after on a 429", () => {
    const nowBefore = Date.now();
    const snap = apiKeyUsageFromHeaders(
      new Headers({
        "anthropic-ratelimit-requests-limit": "1000",
        "anthropic-ratelimit-requests-remaining": "500", // would be 50%
        "retry-after": "30",
      })
    );

    expect(snap.orgPct).toBe(100);
    const resetMs = snap.resetAtOrg!.getTime();
    expect(resetMs).toBeGreaterThanOrEqual(nowBefore + 29_000);
    expect(resetMs).toBeLessThanOrEqual(Date.now() + 31_000);
  });

  it("parses a unix-epoch reset as well as RFC 3339", () => {
    const epoch = 1749826800;
    const snap = apiKeyUsageFromHeaders(
      new Headers({
        "anthropic-ratelimit-tokens-limit": "10",
        "anthropic-ratelimit-tokens-remaining": "5",
        "anthropic-ratelimit-tokens-reset": String(epoch),
      })
    );

    expect(snap.orgPct).toBe(50);
    expect(snap.resetAtOrg?.getTime()).toBe(epoch * 1000);
  });

  it("leaves the org dimension null when no rate headers are present", () => {
    const snap = apiKeyUsageFromHeaders(new Headers());
    expect(snap.orgPct).toBeNull();
    expect(snap.resetAtOrg).toBeNull();
  });
});
