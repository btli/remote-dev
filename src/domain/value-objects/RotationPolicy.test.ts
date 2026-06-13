import { describe, it, expect } from "vitest";
import { RotationPolicy, type RotationCandidate } from "./RotationPolicy";
import { LimitState } from "./LimitState";
import { UsageWindow } from "./UsageWindow";
import { InvalidValueError } from "../errors/DomainError";

const NOW = new Date("2026-06-13T12:00:00.000Z");

/** A limited-state whose only window resets in the future (so unavailable now). */
function limitedFuture(profileId: string): LimitState {
  return LimitState.limited(profileId, {
    windows: [UsageWindow.create("5h", 100, new Date(NOW.getTime() + 3_600_000))],
  });
}

function candidate(profileId: string, priority: number, limitState: LimitState): RotationCandidate {
  return { profileId, priority, limitState };
}

describe("RotationPolicy", () => {
  describe("select", () => {
    it("picks the lowest-priority available candidate", () => {
      const result = RotationPolicy.select(
        [
          candidate("c", 5, LimitState.available("c")),
          candidate("a", 1, LimitState.available("a")),
          candidate("b", 3, LimitState.available("b")),
        ],
        NOW
      );
      expect(result).toBe("a");
    });

    it("skips a limited lower-priority candidate and picks the next available", () => {
      const result = RotationPolicy.select(
        [
          candidate("a", 1, limitedFuture("a")), // lowest priority but limited → skip
          candidate("b", 2, LimitState.available("b")),
          candidate("c", 3, LimitState.available("c")),
        ],
        NOW
      );
      expect(result).toBe("b");
    });

    it("returns null when ALL candidates are limited", () => {
      const result = RotationPolicy.select(
        [candidate("a", 1, limitedFuture("a")), candidate("b", 2, limitedFuture("b"))],
        NOW
      );
      expect(result).toBeNull();
    });

    it("returns null for an empty candidate list", () => {
      expect(RotationPolicy.select([], NOW)).toBeNull();
    });

    it("treats a limited candidate whose reset has passed as available", () => {
      const reopened = LimitState.limited("a", {
        windows: [UsageWindow.create("5h", 100, new Date(NOW.getTime() - 1_000))],
      });
      const result = RotationPolicy.select(
        [candidate("a", 1, reopened), candidate("b", 2, LimitState.available("b"))],
        NOW
      );
      expect(result).toBe("a");
    });

    it("breaks priority ties by input order (stable)", () => {
      const result = RotationPolicy.select(
        [
          candidate("first", 1, LimitState.available("first")),
          candidate("second", 1, LimitState.available("second")),
        ],
        NOW
      );
      expect(result).toBe("first");
    });

    it("throws on a non-finite priority", () => {
      expect(() =>
        RotationPolicy.select([candidate("a", Number.NaN, LimitState.available("a"))], NOW)
      ).toThrow(InvalidValueError);
    });
  });

  describe("instance form", () => {
    it("delegates to the static select", () => {
      const policy = RotationPolicy.create();
      expect(
        policy.select([candidate("a", 1, LimitState.available("a"))], NOW)
      ).toBe("a");
    });
  });
});
