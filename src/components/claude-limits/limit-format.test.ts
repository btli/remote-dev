import { describe, it, expect } from "vitest";
import {
  formatResetCountdown,
  formatLimitStatusLabel,
  formatLimitedBadgeLabel,
  formatPct,
  isLimitedNow,
} from "./limit-format";
import type { LimitStateBlock } from "@/types/claude-limits";

const NOW = Date.parse("2026-06-13T12:00:00.000Z");

function block(over: Partial<LimitStateBlock>): LimitStateBlock {
  return {
    limitStatus: "available",
    window5hPct: null,
    window7dPct: null,
    resetAt5h: null,
    resetAt7d: null,
    effectiveResetAt: null,
    ...over,
  };
}

describe("formatResetCountdown", () => {
  it("returns null for null / past / NaN timestamps", () => {
    expect(formatResetCountdown(null, NOW)).toBeNull();
    expect(formatResetCountdown(NOW - 1000, NOW)).toBeNull();
    expect(formatResetCountdown(NaN, NOW)).toBeNull();
  });

  it("formats hours + minutes", () => {
    expect(formatResetCountdown(NOW + (3 * 60 + 12) * 60_000, NOW)).toBe("3h 12m");
  });

  it("formats minutes only under an hour", () => {
    expect(formatResetCountdown(NOW + 45 * 60_000, NOW)).toBe("45m");
  });

  it("formats <1m for sub-minute deltas", () => {
    expect(formatResetCountdown(NOW + 20_000, NOW)).toBe("<1m");
    expect(formatResetCountdown(NOW + 500, NOW)).toBe("<1m");
    expect(formatResetCountdown(NOW + 60_000, NOW)).toBe("1m");
  });

  it("formats days past 24h", () => {
    expect(formatResetCountdown(NOW + (49 * 60) * 60_000, NOW)).toBe("2d 1h");
  });
});

describe("formatLimitStatusLabel", () => {
  it("maps unknown / null", () => {
    expect(formatLimitStatusLabel(null, NOW)).toBe("Unknown");
    expect(formatLimitStatusLabel(block({ limitStatus: "unknown" }), NOW)).toBe(
      "Unknown"
    );
  });

  it("maps available", () => {
    expect(formatLimitStatusLabel(block({ limitStatus: "available" }), NOW)).toBe(
      "Available"
    );
  });

  it("maps limited with a countdown", () => {
    const s = block({
      limitStatus: "limited",
      effectiveResetAt: NOW + 2 * 60 * 60_000,
    });
    expect(formatLimitStatusLabel(s, NOW)).toBe("Limited — resets in 2h 0m");
  });

  it("maps limited with no/expired reset to bare Limited", () => {
    expect(
      formatLimitStatusLabel(block({ limitStatus: "limited" }), NOW)
    ).toBe("Limited");
  });
});

describe("formatLimitedBadgeLabel", () => {
  it("includes a countdown when known", () => {
    const s = block({ limitStatus: "limited", effectiveResetAt: NOW + 60 * 60_000 });
    expect(formatLimitedBadgeLabel(s, NOW)).toBe("Limited — resets in 1h 0m");
  });

  it("falls back to bare Limited", () => {
    expect(formatLimitedBadgeLabel(null, NOW)).toBe("Limited");
  });
});

describe("formatPct", () => {
  it("formats and rounds, dashes null", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(73.6)).toBe("74%");
    expect(formatPct(100)).toBe("100%");
  });
});

describe("isLimitedNow", () => {
  it("is true only for limited", () => {
    expect(isLimitedNow(null)).toBe(false);
    expect(isLimitedNow(block({ limitStatus: "available" }))).toBe(false);
    expect(isLimitedNow(block({ limitStatus: "limited" }))).toBe(true);
  });
});
