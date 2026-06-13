import { describe, it, expect } from "vitest";
import { LimitState } from "./LimitState";
import { UsageWindow } from "./UsageWindow";
import { InvalidValueError } from "../errors/DomainError";

const NOW = new Date("2026-06-13T12:00:00.000Z");

describe("LimitState", () => {
  describe("creation", () => {
    it("available() builds a not-limited state", () => {
      const s = LimitState.available("p1");
      expect(s.getProfileId()).toBe("p1");
      expect(s.isLimited()).toBe(false);
      expect(s.getLimitedSince()).toBeNull();
    });

    it("limited() builds a limited state and defaults limitedSince to lastCheckedAt", () => {
      const s = LimitState.limited("p1", { lastCheckedAt: NOW, source: "reactive" });
      expect(s.isLimited()).toBe(true);
      expect(s.getSource()).toBe("reactive");
      expect(s.getLimitedSince()?.getTime()).toBe(NOW.getTime());
    });

    it("throws on empty profileId", () => {
      expect(() =>
        LimitState.create({
          profileId: "",
          isLimited: false,
          windows: [],
          source: null,
          limitedSince: null,
          lastCheckedAt: null,
        })
      ).toThrow(InvalidValueError);
    });
  });

  describe("earliestResetAt", () => {
    it("returns null when no window carries a reset", () => {
      const s = LimitState.limited("p1", {
        windows: [UsageWindow.create("5h", 100, null)],
      });
      expect(s.earliestResetAt(NOW)).toBeNull();
    });

    it("returns the earliest of two windows", () => {
      const early = new Date(NOW.getTime() + 1_000); // +1s
      const late = new Date(NOW.getTime() + 60_000); // +60s
      const s = LimitState.limited("p1", {
        windows: [
          UsageWindow.create("7d", 100, late),
          UsageWindow.create("5h", 100, early),
        ],
      });
      expect(s.earliestResetAt(NOW)?.getTime()).toBe(early.getTime());
    });
  });

  describe("isAvailableNow", () => {
    it("available state is always available", () => {
      expect(LimitState.available("p1").isAvailableNow(NOW)).toBe(true);
    });

    it("limited with a future reset is NOT available", () => {
      const future = new Date(NOW.getTime() + 60_000);
      const s = LimitState.limited("p1", { windows: [UsageWindow.create("5h", 100, future)] });
      expect(s.isAvailableNow(NOW)).toBe(false);
    });

    it("limited with a past reset IS available", () => {
      const past = new Date(NOW.getTime() - 60_000);
      const s = LimitState.limited("p1", { windows: [UsageWindow.create("5h", 100, past)] });
      expect(s.isAvailableNow(NOW)).toBe(true);
    });

    it("limited with reset exactly == now IS available (boundary)", () => {
      const exact = new Date(NOW.getTime());
      const s = LimitState.limited("p1", { windows: [UsageWindow.create("5h", 100, exact)] });
      expect(s.isAvailableNow(NOW)).toBe(true);
    });

    it("limited with NO known reset stays NOT available", () => {
      const s = LimitState.limited("p1", { windows: [UsageWindow.create("5h", 100, null)] });
      expect(s.isAvailableNow(NOW)).toBe(false);
    });

    it("limited with two windows is available only once the EARLIEST has passed", () => {
      const past = new Date(NOW.getTime() - 1_000);
      const future = new Date(NOW.getTime() + 60_000);
      const s = LimitState.limited("p1", {
        windows: [
          UsageWindow.create("5h", 100, past),
          UsageWindow.create("7d", 100, future),
        ],
      });
      // Earliest reset (the 5h window) is already in the past → available.
      expect(s.isAvailableNow(NOW)).toBe(true);
    });
  });

  describe("immutability", () => {
    it("getWindows returns a copy; pushing to it does not grow the state", () => {
      const s = LimitState.available("p1", { windows: [UsageWindow.create("5h", 1, null)] });
      const windows = s.getWindows();
      windows.push(UsageWindow.create("7d", 2, null));
      expect(s.getWindows()).toHaveLength(1);
    });

    it("mutating the input windows array does not change the state", () => {
      const input = [UsageWindow.create("5h", 1, null)];
      const s = LimitState.available("p1", { windows: input });
      input.push(UsageWindow.create("7d", 2, null));
      expect(s.getWindows()).toHaveLength(1);
    });

    it("getLimitedSince returns a defensive copy", () => {
      const s = LimitState.limited("p1", { limitedSince: new Date(NOW.getTime()) });
      const got = s.getLimitedSince();
      got!.setFullYear(2000);
      expect(s.getLimitedSince()!.getUTCFullYear()).toBe(2026);
    });
  });

  describe("equality", () => {
    it("equals true for structurally identical states", () => {
      const a = LimitState.limited("p1", {
        windows: [UsageWindow.create("5h", 100, new Date(NOW.getTime()))],
        source: "poller",
        limitedSince: new Date(NOW.getTime()),
        lastCheckedAt: new Date(NOW.getTime()),
      });
      const b = LimitState.limited("p1", {
        windows: [UsageWindow.create("5h", 100, new Date(NOW.getTime()))],
        source: "poller",
        limitedSince: new Date(NOW.getTime()),
        lastCheckedAt: new Date(NOW.getTime()),
      });
      expect(a.equals(b)).toBe(true);
    });

    it("equals false when limited differs", () => {
      expect(LimitState.available("p1").equals(LimitState.limited("p1"))).toBe(false);
    });

    it("equals false when windows differ", () => {
      const a = LimitState.available("p1", { windows: [UsageWindow.create("5h", 1, null)] });
      const b = LimitState.available("p1", { windows: [UsageWindow.create("5h", 2, null)] });
      expect(a.equals(b)).toBe(false);
    });
  });
});
