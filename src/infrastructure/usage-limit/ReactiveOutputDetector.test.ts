// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ReactiveOutputDetector } from "./ReactiveOutputDetector";

describe("ReactiveOutputDetector.parse", () => {
  describe("limit-phrase detection", () => {
    it("detects the canonical 'Claude usage limit reached' phrase", () => {
      const r = ReactiveOutputDetector.parse(
        "Claude usage limit reached. Your limit will reset later."
      );
      expect(r.isLimited).toBe(true);
    });

    it("detects a generic 'usage limit reached' when the text mentions Claude", () => {
      const r = ReactiveOutputDetector.parse(
        "Error from Claude: usage limit reached"
      );
      expect(r.isLimited).toBe(true);
    });

    it("detects \"you've hit your usage limit\" when Claude is mentioned", () => {
      const r = ReactiveOutputDetector.parse(
        "Claude: You've hit your usage limit for now."
      );
      expect(r.isLimited).toBe(true);
    });

    it("is case-insensitive", () => {
      const r = ReactiveOutputDetector.parse("CLAUDE USAGE LIMIT REACHED");
      expect(r.isLimited).toBe(true);
    });

    it("detects 'Claude usage limit reached. Your limit will reset at 3pm.'", () => {
      const r = ReactiveOutputDetector.parse(
        "Claude usage limit reached. Your limit will reset at 3pm."
      );
      expect(r.isLimited).toBe(true);
      // Bare clock disclosure with no epoch header → no reset extracted.
      expect(r.resetAt5h).toBeNull();
      expect(r.resetAt7d).toBeNull();
    });
  });

  describe("requires Claude context for generic phrases (no false positives)", () => {
    it("does NOT flag 'npm usage limit reached' (no Claude context)", () => {
      const r = ReactiveOutputDetector.parse("npm usage limit reached");
      expect(r.isLimited).toBe(false);
      expect(r.resetAt5h).toBeNull();
      expect(r.resetAt7d).toBeNull();
    });

    it("does NOT flag a GitHub-style quota message", () => {
      const r = ReactiveOutputDetector.parse(
        "GitHub API: you've reached your usage limit for this hour."
      );
      expect(r.isLimited).toBe(false);
    });

    it("does not flag a generic 'rate limit' mention", () => {
      const r = ReactiveOutputDetector.parse(
        "Tip: rate limit your requests to avoid throttling."
      );
      expect(r.isLimited).toBe(false);
      expect(r.resetAt5h).toBeNull();
    });

    it("does not flag 'character limit' / 'limit your'", () => {
      expect(ReactiveOutputDetector.parse("The character limit is 4000.").isLimited).toBe(false);
      expect(ReactiveOutputDetector.parse("Please limit your input.").isLimited).toBe(false);
    });

    it("does not flag a reset-time line on its own (no limit phrase)", () => {
      const r = ReactiveOutputDetector.parse("Your quota resets at 3pm.");
      expect(r.isLimited).toBe(false);
      expect(r.resetAt5h).toBeNull();
      expect(r.resetAt7d).toBeNull();
    });

    it("handles empty / non-string input", () => {
      expect(ReactiveOutputDetector.parse("").isLimited).toBe(false);
      // Defends against runtime non-string input (the type says string).
      expect(
        ReactiveOutputDetector.parse(null as unknown as string).isLimited
      ).toBe(false);
    });
  });

  describe("reset extraction (epoch headers only)", () => {
    it("reports limited with no reset when no epoch header is disclosed", () => {
      const r = ReactiveOutputDetector.parse("Claude usage limit reached.");
      expect(r.isLimited).toBe(true);
      expect(r.resetAt5h).toBeNull();
      expect(r.resetAt7d).toBeNull();
    });

    it("parses the unified-5h-reset epoch header into resetAt5h only", () => {
      const epoch = 1749826800; // 2025-06-13T15:00:00Z
      const r = ReactiveOutputDetector.parse(
        `Claude usage limit reached\nanthropic-ratelimit-unified-5h-reset: ${epoch}`
      );
      expect(r.isLimited).toBe(true);
      expect(r.resetAt5h?.getTime()).toBe(epoch * 1000);
      expect(r.resetAt7d).toBeNull();
    });

    it("parses the unified-7d-reset epoch header into resetAt7d only", () => {
      const epoch = 1750000000;
      const r = ReactiveOutputDetector.parse(
        `Claude usage limit reached\nanthropic-ratelimit-unified-7d-reset: ${epoch}`
      );
      expect(r.resetAt7d?.getTime()).toBe(epoch * 1000);
      expect(r.resetAt5h).toBeNull();
    });

    it("parses BOTH headers independently when both are present", () => {
      const epoch5h = 1749826800;
      const epoch7d = 1750000000;
      const r = ReactiveOutputDetector.parse(
        [
          "Claude usage limit reached",
          `anthropic-ratelimit-unified-5h-reset: ${epoch5h}`,
          `anthropic-ratelimit-unified-7d-reset: ${epoch7d}`,
        ].join("\n")
      );
      expect(r.resetAt5h?.getTime()).toBe(epoch5h * 1000);
      expect(r.resetAt7d?.getTime()).toBe(epoch7d * 1000);
    });

    it("ignores a bare clock disclosure (no local-timezone guess)", () => {
      const r = ReactiveOutputDetector.parse(
        "Claude usage limit reached. Resets at 11:30pm."
      );
      expect(r.isLimited).toBe(true);
      expect(r.resetAt5h).toBeNull();
      expect(r.resetAt7d).toBeNull();
    });

    it("uses the epoch header even when a clock disclosure is also present", () => {
      const epoch = 1749826800;
      const r = ReactiveOutputDetector.parse(
        `Claude usage limit reached. Resets at 9am.\nanthropic-ratelimit-unified-5h-reset: ${epoch}`
      );
      expect(r.resetAt5h?.getTime()).toBe(epoch * 1000);
    });
  });

  describe("gateway shape", () => {
    it("supports only the subscription kind", () => {
      const d = new ReactiveOutputDetector();
      expect(d.supports("subscription")).toBe(true);
      expect(d.supports("api_key")).toBe(false);
    });

    it("fetchLimitState returns null (event-driven, nothing to poll)", async () => {
      const d = new ReactiveOutputDetector();
      await expect(d.fetchLimitState()).resolves.toBeNull();
    });
  });
});
