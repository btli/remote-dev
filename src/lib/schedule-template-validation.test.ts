import { describe, expect, it } from "vitest";

import {
  normalizeScheduleTemplateCommands,
  validateScheduleTemplateOptions,
} from "./schedule-template-validation";

describe("schedule template validation", () => {
  it.each([
    [{ maxRetries: -1 }, "Max retries"],
    [{ maxRetries: 11 }, "Max retries"],
    [{ maxRetries: 1.5 }, "Max retries"],
    [{ retryDelaySeconds: -1 }, "Retry delay"],
    [{ retryDelaySeconds: 3_601 }, "Retry delay"],
    [{ timeoutSeconds: -1 }, "Timeout"],
    [{ timeoutSeconds: 86_401 }, "Timeout"],
  ])("rejects invalid numeric options %#", (input, message) => {
    expect(validateScheduleTemplateOptions(input)).toContain(message);
  });

  it.each([
    null,
    [],
    [null],
    [{}],
    [{ command: 123 }],
    [{ command: " " }],
    [{ command: "echo ok", order: -1 }],
    [{ command: "echo ok", delayBeforeSeconds: 1.5 }],
    [{ command: "echo ok", delayBeforeSeconds: -1 }],
    [{ command: "echo ok", continueOnError: "yes" }],
  ])("rejects malformed command input %#", (commands) => {
    expect(normalizeScheduleTemplateCommands(commands)).toBeNull();
  });

  it("derives order and defaults optional command fields", () => {
    expect(
      normalizeScheduleTemplateCommands([
        { command: "echo first", order: 99 },
        {
          command: "echo second",
          delayBeforeSeconds: 5,
          continueOnError: true,
        },
      ])
    ).toEqual([
      {
        command: "echo first",
        order: 0,
        delayBeforeSeconds: 0,
        continueOnError: false,
      },
      {
        command: "echo second",
        order: 1,
        delayBeforeSeconds: 5,
        continueOnError: true,
      },
    ]);
  });
});
