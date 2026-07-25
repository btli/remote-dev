import { describe, expect, it } from "vitest";

import { describeIntervalSchedule } from "./schedule-format";

const ANCHOR = new Date("2026-07-25T09:30:00.000Z");

describe("describeIntervalSchedule", () => {
  it.each([
    [86_400, "Every 1 day from"],
    [7_200, "Every 2 hours from"],
    [300, "Every 5 minutes from"],
    [60, "Every 1 minute from"],
  ])("formats %i seconds using the largest even unit", (seconds, prefix) => {
    expect(describeIntervalSchedule(seconds, ANCHOR, "UTC")).toMatch(
      new RegExp(`^${prefix}`)
    );
  });

  it("uses whole seconds when the interval does not divide into a larger unit", () => {
    expect(describeIntervalSchedule(61, ANCHOR, "UTC")).toMatch(
      /^Every 61 seconds from/
    );
  });
});
