// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { isUsagePollEnabled } from "./poll-config";

const KEY = "RDV_CLAUDE_USAGE_POLL_ENABLED";
const original = process.env[KEY];

function setFlag(value: string | undefined): void {
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
}

afterEach(() => setFlag(original));

describe("isUsagePollEnabled", () => {
  it("is OFF when the flag is unset", () => {
    // [review G7] docs/SETUP.md ships a bare `RDV_CLAUDE_USAGE_POLL_ENABLED=`
    // line. A permissive default would have started outbound traffic to
    // Anthropic every ~10 minutes, with stored OAuth tokens, on an unchanged
    // config file — with no operator having chosen it.
    setFlag(undefined);
    expect(isUsagePollEnabled()).toBe(false);
  });

  it("is OFF when the flag is set but empty", () => {
    setFlag("");
    expect(isUsagePollEnabled()).toBe(false);
  });

  it("is ON only for an explicit positive value", () => {
    for (const value of ["1", "true", "on", "yes", "TRUE", " On "]) {
      setFlag(value);
      expect(isUsagePollEnabled(), `for ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it("is OFF for explicit negatives", () => {
    for (const value of ["0", "false", "off", "no"]) {
      setFlag(value);
      expect(isUsagePollEnabled(), `for ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("is OFF for anything unrecognized (a typo must not enable it)", () => {
    for (const value of ["enabled", "yep", "2", "y"]) {
      setFlag(value);
      expect(isUsagePollEnabled(), `for ${JSON.stringify(value)}`).toBe(false);
    }
  });
});
