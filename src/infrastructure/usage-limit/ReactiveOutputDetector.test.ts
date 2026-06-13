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

    it("detects 'usage limit reached' without the Claude prefix", () => {
      const r = ReactiveOutputDetector.parse("Error: usage limit reached");
      expect(r.isLimited).toBe(true);
    });

    it("detects \"you've hit your usage limit\"", () => {
      const r = ReactiveOutputDetector.parse("You've hit your usage limit for now.");
      expect(r.isLimited).toBe(true);
    });

    it("is case-insensitive", () => {
      const r = ReactiveOutputDetector.parse("CLAUDE USAGE LIMIT REACHED");
      expect(r.isLimited).toBe(true);
    });
  });

  describe("no false positives on unrelated 'limit' text", () => {
    it("does not flag a generic 'rate limit' mention", () => {
      const r = ReactiveOutputDetector.parse(
        "Tip: rate limit your requests to avoid throttling."
      );
      expect(r.isLimited).toBe(false);
      expect(r.resetAt).toBeNull();
    });

    it("does not flag 'character limit' / 'limit your'", () => {
      expect(ReactiveOutputDetector.parse("The character limit is 4000.").isLimited).toBe(false);
      expect(ReactiveOutputDetector.parse("Please limit your input.").isLimited).toBe(false);
    });

    it("does not flag a reset-time line on its own (no limit phrase)", () => {
      const r = ReactiveOutputDetector.parse("Your quota resets at 3pm.");
      expect(r.isLimited).toBe(false);
      expect(r.resetAt).toBeNull();
    });

    it("handles empty / non-string input", () => {
      expect(ReactiveOutputDetector.parse("").isLimited).toBe(false);
      // @ts-expect-error intentional: defends against runtime non-string
      expect(ReactiveOutputDetector.parse(null).isLimited).toBe(false);
    });
  });

  describe("reset extraction (optional)", () => {
    it("reports limited with no reset when none is disclosed", () => {
      const r = ReactiveOutputDetector.parse("Claude usage limit reached.");
      expect(r.isLimited).toBe(true);
      expect(r.resetAt).toBeNull();
    });

    it("parses the unified-5h-reset epoch header", () => {
      const epoch = 1749826800; // 2025-06-13T15:00:00Z
      const r = ReactiveOutputDetector.parse(
        `Claude usage limit reached\nanthropic-ratelimit-unified-5h-reset: ${epoch}`
      );
      expect(r.isLimited).toBe(true);
      expect(r.resetAt?.getTime()).toBe(epoch * 1000);
    });

    it("parses the unified-7d-reset epoch header", () => {
      const epoch = 1750000000;
      const r = ReactiveOutputDetector.parse(
        `usage limit reached\nanthropic-ratelimit-unified-7d-reset: ${epoch}`
      );
      expect(r.resetAt?.getTime()).toBe(epoch * 1000);
    });

    it("parses 'resets at 3pm' relative to now", () => {
      const now = new Date("2026-06-13T10:00:00");
      const r = ReactiveOutputDetector.parse(
        "Claude usage limit reached. Resets at 3pm.",
        now
      );
      expect(r.isLimited).toBe(true);
      expect(r.resetAt?.getHours()).toBe(15);
      expect(r.resetAt?.getMinutes()).toBe(0);
      // Same day since 3pm is after 10am.
      expect(r.resetAt?.getDate()).toBe(13);
    });

    it("parses 'resets at 11:30pm' with minutes", () => {
      const now = new Date("2026-06-13T10:00:00");
      const r = ReactiveOutputDetector.parse(
        "Claude usage limit reached. Your limit resets at 11:30pm.",
        now
      );
      expect(r.resetAt?.getHours()).toBe(23);
      expect(r.resetAt?.getMinutes()).toBe(30);
    });

    it("parses a bare 24h 'resets at 15:00'", () => {
      const now = new Date("2026-06-13T10:00:00");
      const r = ReactiveOutputDetector.parse(
        "usage limit reached — resets at 15:00",
        now
      );
      expect(r.resetAt?.getHours()).toBe(15);
    });

    it("rolls a past clock time to the next day", () => {
      const now = new Date("2026-06-13T20:00:00");
      const r = ReactiveOutputDetector.parse(
        "Claude usage limit reached. Resets at 9am.",
        now
      );
      expect(r.resetAt?.getHours()).toBe(9);
      expect(r.resetAt?.getDate()).toBe(14); // next day
    });

    it("prefers the epoch header over a clock disclosure when both present", () => {
      const epoch = 1749826800;
      const r = ReactiveOutputDetector.parse(
        `Claude usage limit reached. Resets at 9am.\nanthropic-ratelimit-unified-5h-reset: ${epoch}`,
        new Date("2026-06-13T20:00:00")
      );
      expect(r.resetAt?.getTime()).toBe(epoch * 1000);
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
