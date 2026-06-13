import { describe, it, expect } from "vitest";
import { RateLimitHeaders } from "./RateLimitHeaders";

const NOW = new Date("2026-06-13T12:00:00Z");

describe("RateLimitHeaders", () => {
  describe("parse + isLimited", () => {
    it("is NOT limited when requests remain", () => {
      const rl = RateLimitHeaders.parse(
        {
          "anthropic-ratelimit-requests-remaining": "40",
          "anthropic-ratelimit-requests-limit": "50",
          "anthropic-ratelimit-requests-reset": "2026-06-13T12:05:00Z",
        },
        NOW
      );
      expect(rl.isLimited()).toBe(false);
      expect(rl.availableAt()).toBeNull();
    });

    it("is limited when requests are exhausted (remaining 0)", () => {
      const rl = RateLimitHeaders.parse(
        {
          "anthropic-ratelimit-requests-remaining": "0",
          "anthropic-ratelimit-requests-limit": "50",
          "anthropic-ratelimit-requests-reset": "2026-06-13T12:05:00Z",
        },
        NOW
      );
      expect(rl.isLimited()).toBe(true);
      expect(rl.availableAt()?.toISOString()).toBe("2026-06-13T12:05:00.000Z");
    });

    it("is limited when tokens are exhausted", () => {
      const rl = RateLimitHeaders.parse(
        {
          "anthropic-ratelimit-requests-remaining": "10",
          "anthropic-ratelimit-tokens-remaining": "0",
          "anthropic-ratelimit-tokens-reset": "2026-06-13T12:01:00Z",
        },
        NOW
      );
      expect(rl.isLimited()).toBe(true);
      expect(rl.availableAt()?.toISOString()).toBe("2026-06-13T12:01:00.000Z");
    });

    it("is limited when retry-after is present (seconds → absolute)", () => {
      const rl = RateLimitHeaders.parse({ "retry-after": "30" }, NOW);
      expect(rl.isLimited()).toBe(true);
      expect(rl.hasRetryAfter()).toBe(true);
      expect(rl.availableAt()?.toISOString()).toBe("2026-06-13T12:00:30.000Z");
    });

    it("picks the SOONEST applicable reset across active constraints", () => {
      const rl = RateLimitHeaders.parse(
        {
          "retry-after": "120", // → 12:02:00
          "anthropic-ratelimit-requests-remaining": "0",
          "anthropic-ratelimit-requests-reset": "2026-06-13T12:05:00Z",
        },
        NOW
      );
      // min(12:02:00, 12:05:00) = 12:02:00
      expect(rl.availableAt()?.toISOString()).toBe("2026-06-13T12:02:00.000Z");
    });

    it("ignores reset of a NON-exhausted window", () => {
      const rl = RateLimitHeaders.parse(
        {
          "anthropic-ratelimit-requests-remaining": "5", // not exhausted
          "anthropic-ratelimit-requests-reset": "2026-06-13T13:00:00Z",
        },
        NOW
      );
      expect(rl.isLimited()).toBe(false);
      expect(rl.availableAt()).toBeNull();
    });

    it("parses epoch-seconds resets", () => {
      const epoch = Math.floor(
        new Date("2026-06-13T12:10:00Z").getTime() / 1000
      ).toString();
      const rl = RateLimitHeaders.parse(
        {
          "anthropic-ratelimit-requests-remaining": "0",
          "anthropic-ratelimit-requests-reset": epoch,
        },
        NOW
      );
      expect(rl.availableAt()?.toISOString()).toBe("2026-06-13T12:10:00.000Z");
    });

    it("works with a Headers instance (case-insensitive)", () => {
      const h = new Headers();
      h.set("Anthropic-RateLimit-Requests-Remaining", "0");
      h.set("Anthropic-RateLimit-Requests-Reset", "2026-06-13T12:03:00Z");
      const rl = RateLimitHeaders.parse(h, NOW);
      expect(rl.isLimited()).toBe(true);
      expect(rl.availableAt()?.toISOString()).toBe("2026-06-13T12:03:00.000Z");
    });
  });

  describe("utilizationPct", () => {
    it("computes the most-constrained dimension", () => {
      const rl = RateLimitHeaders.parse(
        {
          "anthropic-ratelimit-requests-remaining": "25",
          "anthropic-ratelimit-requests-limit": "50", // 50% used
          "anthropic-ratelimit-tokens-remaining": "100",
          "anthropic-ratelimit-tokens-limit": "1000", // 90% used
        },
        NOW
      );
      expect(rl.utilizationPct()).toBe(90);
    });
    it("is null when no dimension discloses both limit + remaining", () => {
      const rl = RateLimitHeaders.parse({ "retry-after": "10" }, NOW);
      expect(rl.utilizationPct()).toBeNull();
    });
  });

  describe("toLimitState (api_key semantics — NOT a fixed 5h/7d reset)", () => {
    it("limited state becomes available at the rate reset, not a fixed window", () => {
      const rl = RateLimitHeaders.parse(
        {
          "anthropic-ratelimit-requests-remaining": "0",
          "anthropic-ratelimit-requests-limit": "50",
          "anthropic-ratelimit-requests-reset": "2026-06-13T12:05:00Z",
        },
        NOW
      );
      const state = rl.toLimitState("profile-1", { observedAt: NOW });
      expect(state.isLimited()).toBe(true);

      // Not available now (reset is in the future)…
      expect(state.isAvailableNow(NOW)).toBe(false);
      // …but available once the rate window passes.
      expect(
        state.isAvailableNow(new Date("2026-06-13T12:05:00Z"))
      ).toBe(true);

      // The reset rides on the `org` window → effectiveResetAt; no 5h/7d.
      const snap = state.toSnapshot();
      expect(snap.window5hPct).toBeNull();
      expect(snap.window7dPct).toBeNull();
      expect(snap.effectiveResetAt?.toISOString()).toBe(
        "2026-06-13T12:05:00.000Z"
      );
    });

    it("not-limited → available state", () => {
      const rl = RateLimitHeaders.parse(
        { "anthropic-ratelimit-requests-remaining": "10" },
        NOW
      );
      const state = rl.toLimitState("profile-1", { observedAt: NOW });
      expect(state.isLimited()).toBe(false);
      expect(state.isAvailableNow(NOW)).toBe(true);
    });

    it("limited with no disclosed reset stays unavailable until cleared", () => {
      const rl = RateLimitHeaders.parse(
        { "anthropic-ratelimit-requests-remaining": "0" },
        NOW
      );
      const state = rl.toLimitState("profile-1", { observedAt: NOW });
      expect(state.isLimited()).toBe(true);
      // No reset → not auto-available even far in the future.
      expect(
        state.isAvailableNow(new Date("2099-01-01T00:00:00Z"))
      ).toBe(false);
    });
  });
});
