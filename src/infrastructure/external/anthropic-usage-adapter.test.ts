// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  fetchClaudeUsage,
  type FetchLike,
} from "./anthropic-usage-adapter";

/**
 * Build a FetchLike that returns the given status + headers and records the
 * request it was called with (so we can assert on credential headers without
 * ever exposing the token elsewhere).
 */
function fakeFetch(
  status: number,
  headers: Record<string, string>
): { fetch: FetchLike; calls: Array<Parameters<FetchLike>> } {
  const calls: Array<Parameters<FetchLike>> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push([url, init]);
    return { status, headers: new Headers(headers) };
  };
  return { fetch, calls };
}

describe("fetchClaudeUsage", () => {
  describe("guards", () => {
    it("returns null for an empty token without calling fetch", async () => {
      const { fetch, calls } = fakeFetch(200, {});
      const result = await fetchClaudeUsage("", "subscription", fetch);
      expect(result).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it("returns null (best-effort) when fetch throws", async () => {
      const throwing: FetchLike = async () => {
        throw new Error("network down");
      };
      const result = await fetchClaudeUsage("tok", "subscription", throwing);
      expect(result).toBeNull();
    });
  });

  describe("subscription (unified 5h/7d headers)", () => {
    it("derives utilization and reset (unix-epoch reset) for both windows", async () => {
      const epoch5h = 1749826800; // 2025-06-13T15:00:00Z
      const epoch7d = 1750000000;
      const { fetch } = fakeFetch(200, {
        "anthropic-ratelimit-unified-5h-limit": "1000",
        "anthropic-ratelimit-unified-5h-remaining": "250", // 75% used
        "anthropic-ratelimit-unified-5h-reset": String(epoch5h),
        "anthropic-ratelimit-unified-7d-limit": "10000",
        "anthropic-ratelimit-unified-7d-remaining": "9000", // 10% used
        "anthropic-ratelimit-unified-7d-reset": String(epoch7d),
      });

      const snap = await fetchClaudeUsage("oauth-token", "subscription", fetch);

      expect(snap).not.toBeNull();
      expect(snap!.window5hPct).toBe(75);
      expect(snap!.window7dPct).toBe(10);
      expect(snap!.resetAt5h?.getTime()).toBe(epoch5h * 1000);
      expect(snap!.resetAt7d?.getTime()).toBe(epoch7d * 1000);
      // No api_key org dimension on a subscription read.
      expect(snap!.orgPct).toBeNull();
      expect(snap!.resetAtOrg).toBeNull();
    });

    it("also parses an RFC 3339 reset value (documented format)", async () => {
      const iso = "2025-06-13T15:00:00Z";
      const { fetch } = fakeFetch(200, {
        "anthropic-ratelimit-unified-5h-limit": "100",
        "anthropic-ratelimit-unified-5h-remaining": "0",
        "anthropic-ratelimit-unified-5h-reset": iso,
      });

      const snap = await fetchClaudeUsage("oauth-token", "subscription", fetch);

      expect(snap!.window5hPct).toBe(100);
      expect(snap!.resetAt5h?.toISOString()).toBe("2025-06-13T15:00:00.000Z");
    });

    it("reads headers from a 429 response (over the limit)", async () => {
      const { fetch } = fakeFetch(429, {
        "anthropic-ratelimit-unified-5h-limit": "1000",
        "anthropic-ratelimit-unified-5h-remaining": "0", // 100% used
      });

      const snap = await fetchClaudeUsage("oauth-token", "subscription", fetch);

      expect(snap).not.toBeNull();
      expect(snap!.window5hPct).toBe(100);
    });

    it("returns null when no usage headers are present", async () => {
      const { fetch } = fakeFetch(200, { "content-type": "application/json" });
      const snap = await fetchClaudeUsage("oauth-token", "subscription", fetch);
      expect(snap).toBeNull();
    });

    it("leaves a window null when its limit is missing or zero", async () => {
      const { fetch } = fakeFetch(200, {
        // 5h has only a reset, no limit/remaining → pct null but reset present
        "anthropic-ratelimit-unified-5h-reset": "1749826800",
        // 7d has a zero limit → not derivable → null
        "anthropic-ratelimit-unified-7d-limit": "0",
        "anthropic-ratelimit-unified-7d-remaining": "0",
      });

      const snap = await fetchClaudeUsage("oauth-token", "subscription", fetch);

      expect(snap).not.toBeNull();
      expect(snap!.window5hPct).toBeNull();
      expect(snap!.resetAt5h?.getTime()).toBe(1749826800 * 1000);
      expect(snap!.window7dPct).toBeNull();
    });

    it("sends Bearer + oauth beta for a subscription probe (token not leaked elsewhere)", async () => {
      const { fetch, calls } = fakeFetch(200, {
        "anthropic-ratelimit-unified-5h-limit": "10",
        "anthropic-ratelimit-unified-5h-remaining": "5",
      });

      await fetchClaudeUsage("secret-oauth", "subscription", fetch);

      const [, init] = calls[0];
      expect(init.headers["authorization"]).toBe("Bearer secret-oauth");
      expect(init.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
      expect(init.headers["x-api-key"]).toBeUndefined();
    });
  });

  describe("api_key (documented rate-limit headers)", () => {
    it("uses the worst-case utilization across rate families + soonest reset", async () => {
      const soon = "2025-06-13T15:00:00Z";
      const later = "2025-06-13T16:00:00Z";
      const { fetch } = fakeFetch(200, {
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
      });

      const snap = await fetchClaudeUsage("sk-ant-key", "api_key", fetch);

      expect(snap).not.toBeNull();
      // Worst case across families is 90%.
      expect(snap!.orgPct).toBe(90);
      // Soonest reset is the input-tokens one.
      expect(snap!.resetAtOrg?.toISOString()).toBe("2025-06-13T15:00:00.000Z");
      // Subscription windows stay null for an api_key read.
      expect(snap!.window5hPct).toBeNull();
      expect(snap!.window7dPct).toBeNull();
      expect(snap!.resetAt5h).toBeNull();
      expect(snap!.resetAt7d).toBeNull();
    });

    it("pins utilization to 100 and uses retry-after on a 429", async () => {
      const nowBefore = Date.now();
      const { fetch } = fakeFetch(429, {
        "anthropic-ratelimit-requests-limit": "1000",
        "anthropic-ratelimit-requests-remaining": "500", // would be 50%
        "retry-after": "30",
      });

      const snap = await fetchClaudeUsage("sk-ant-key", "api_key", fetch);

      expect(snap).not.toBeNull();
      // retry-after overrides the per-family pct → fully limited right now.
      expect(snap!.orgPct).toBe(100);
      const resetMs = snap!.resetAtOrg!.getTime();
      // ~30s in the future (allow a small window for clock drift in the test).
      expect(resetMs).toBeGreaterThanOrEqual(nowBefore + 29_000);
      expect(resetMs).toBeLessThanOrEqual(Date.now() + 31_000);
    });

    it("sends x-api-key (not Bearer) for an api_key probe", async () => {
      const { fetch, calls } = fakeFetch(200, {
        "anthropic-ratelimit-requests-limit": "10",
        "anthropic-ratelimit-requests-remaining": "5",
      });

      await fetchClaudeUsage("sk-ant-secret", "api_key", fetch);

      const [, init] = calls[0];
      expect(init.headers["x-api-key"]).toBe("sk-ant-secret");
      expect(init.headers["authorization"]).toBeUndefined();
      expect(init.headers["anthropic-beta"]).toBeUndefined();
    });

    it("returns null when no rate-limit headers are present", async () => {
      const { fetch } = fakeFetch(401, {});
      const snap = await fetchClaudeUsage("sk-ant-key", "api_key", fetch);
      expect(snap).toBeNull();
    });
  });

  describe("probe shape", () => {
    it("POSTs a minimal one-token probe with the pinned anthropic-version", async () => {
      const { fetch, calls } = fakeFetch(200, {
        "anthropic-ratelimit-unified-5h-limit": "10",
        "anthropic-ratelimit-unified-5h-remaining": "5",
      });

      await fetchClaudeUsage("tok", "subscription", fetch);

      const [url, init] = calls[0];
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(init.method).toBe("POST");
      expect(init.headers["anthropic-version"]).toBe("2023-06-01");
      const body = JSON.parse(init.body) as { max_tokens: number };
      expect(body.max_tokens).toBe(1);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("defaults to subscription when no kind is given", async () => {
      const { fetch, calls } = fakeFetch(200, {
        "anthropic-ratelimit-unified-5h-limit": "10",
        "anthropic-ratelimit-unified-5h-remaining": "5",
      });

      await fetchClaudeUsage("tok", undefined, fetch);

      const [, init] = calls[0];
      expect(init.headers["authorization"]).toBe("Bearer tok");
    });
  });
});
