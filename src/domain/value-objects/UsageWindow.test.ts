import { describe, it, expect } from "vitest";
import { UsageWindow } from "./UsageWindow";
import { InvalidValueError } from "../errors/DomainError";

describe("UsageWindow", () => {
  describe("creation + pct bounds", () => {
    it("accepts 0%", () => {
      const w = UsageWindow.create("5h", 0, null);
      expect(w.getUtilizationPct()).toBe(0);
      expect(w.isExhausted()).toBe(false);
    });

    it("accepts 100% (exhausted)", () => {
      const w = UsageWindow.create("7d", 100, null);
      expect(w.getUtilizationPct()).toBe(100);
      expect(w.isExhausted()).toBe(true);
    });

    it("accepts a mid-range value", () => {
      expect(UsageWindow.create("org", 42.5, null).getUtilizationPct()).toBe(42.5);
    });

    it("throws below 0", () => {
      expect(() => UsageWindow.create("5h", -1, null)).toThrow(InvalidValueError);
    });

    it("throws above 100", () => {
      expect(() => UsageWindow.create("5h", 101, null)).toThrow(InvalidValueError);
    });

    it("throws on non-finite pct", () => {
      expect(() => UsageWindow.create("5h", Number.NaN, null)).toThrow(InvalidValueError);
      expect(() => UsageWindow.create("5h", Number.POSITIVE_INFINITY, null)).toThrow(
        InvalidValueError
      );
    });

    it("throws on unknown duration", () => {
      // @ts-expect-error - exercising the runtime guard with an invalid duration
      expect(() => UsageWindow.create("1h", 10, null)).toThrow(InvalidValueError);
    });

    it("isExhausted true above 100 boundary is unreachable (guarded), exactly 100 is exhausted", () => {
      expect(UsageWindow.create("5h", 99.9, null).isExhausted()).toBe(false);
      expect(UsageWindow.create("5h", 100, null).isExhausted()).toBe(true);
    });
  });

  describe("msUntilReset", () => {
    const now = new Date("2026-06-13T12:00:00.000Z");

    it("returns null when resetAt is null", () => {
      expect(UsageWindow.create("5h", 50, null).msUntilReset(now)).toBeNull();
    });

    it("returns positive ms for a future reset", () => {
      const reset = new Date(now.getTime() + 3_600_000); // +1h
      expect(UsageWindow.create("5h", 50, reset).msUntilReset(now)).toBe(3_600_000);
    });

    it("returns 0 for a past reset (never negative)", () => {
      const reset = new Date(now.getTime() - 60_000); // -1m
      expect(UsageWindow.create("5h", 50, reset).msUntilReset(now)).toBe(0);
    });

    it("returns 0 when reset is exactly now", () => {
      expect(UsageWindow.create("5h", 50, new Date(now.getTime())).msUntilReset(now)).toBe(0);
    });
  });

  describe("immutability", () => {
    it("getResetAt returns a defensive copy", () => {
      const reset = new Date("2026-06-13T15:00:00.000Z");
      const w = UsageWindow.create("5h", 10, reset);
      const got = w.getResetAt();
      expect(got).not.toBeNull();
      got!.setFullYear(2000);
      expect(w.getResetAt()!.getUTCFullYear()).toBe(2026);
    });

    it("mutating the input Date does not change the window", () => {
      const reset = new Date("2026-06-13T15:00:00.000Z");
      const w = UsageWindow.create("5h", 10, reset);
      reset.setFullYear(2000);
      expect(w.getResetAt()!.getUTCFullYear()).toBe(2026);
    });
  });

  describe("equality", () => {
    const reset = new Date("2026-06-13T15:00:00.000Z");

    it("equals true for identical windows", () => {
      const a = UsageWindow.create("5h", 50, new Date(reset.getTime()));
      const b = UsageWindow.create("5h", 50, new Date(reset.getTime()));
      expect(a.equals(b)).toBe(true);
    });

    it("equals false for different pct / duration / reset", () => {
      const base = UsageWindow.create("5h", 50, new Date(reset.getTime()));
      expect(base.equals(UsageWindow.create("5h", 51, new Date(reset.getTime())))).toBe(false);
      expect(base.equals(UsageWindow.create("7d", 50, new Date(reset.getTime())))).toBe(false);
      expect(base.equals(UsageWindow.create("5h", 50, null))).toBe(false);
    });

    it("equals true for two null-reset windows", () => {
      expect(
        UsageWindow.create("org", 0, null).equals(UsageWindow.create("org", 0, null))
      ).toBe(true);
    });
  });
});
