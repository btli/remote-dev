// @vitest-environment node
import { describe, it, expect } from "vitest";

import { resolveStartupEnv } from "./tmux-service";

describe("resolveStartupEnv", () => {
  it("returns suppression vars when startup command is present and no caller env", () => {
    const result = resolveStartupEnv("claude --resume", undefined);
    expect(result).toBeDefined();
    expect(result!.DISABLE_AUTO_UPDATE).toBe("true");
    expect(result!.DISABLE_UPDATE_PROMPT).toBe("true");
  });

  it("includes both suppression keys and caller env when startup command is present", () => {
    const result = resolveStartupEnv("claude --resume", { FOO: "bar" });
    expect(result).toBeDefined();
    expect(result!.DISABLE_AUTO_UPDATE).toBe("true");
    expect(result!.DISABLE_UPDATE_PROMPT).toBe("true");
    expect(result!.FOO).toBe("bar");
  });

  it("caller override wins over suppression default", () => {
    const result = resolveStartupEnv("claude --resume", { DISABLE_AUTO_UPDATE: "false" });
    expect(result).toBeDefined();
    expect(result!.DISABLE_AUTO_UPDATE).toBe("false");
    // The other suppression key is still set
    expect(result!.DISABLE_UPDATE_PROMPT).toBe("true");
  });

  it("returns undefined unchanged when startup command is undefined", () => {
    const result = resolveStartupEnv(undefined, undefined);
    expect(result).toBeUndefined();
  });

  it("returns env unchanged when startup command is an empty string", () => {
    const result = resolveStartupEnv("", { FOO: "bar" });
    expect(result).toEqual({ FOO: "bar" });
  });

  it("returns env unchanged when startup command is whitespace only", () => {
    const result = resolveStartupEnv("   ", undefined);
    expect(result).toBeUndefined();
  });
});
