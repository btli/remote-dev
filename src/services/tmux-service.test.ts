// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/exec", () => ({
  execFile: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  execFileCheck: vi.fn(async () => true),
  // exitCode 1 = `tmux has-session` says the session does NOT exist yet.
  execFileNoThrow: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 1 })),
}));

import { execFile } from "@/lib/exec";
import { createSession, resolveStartupEnv } from "./tmux-service";

const execFileMock = vi.mocked(execFile);

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

describe("createSession", () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  // [remote-dev-ipbo] `cwd` is a required parameter — omitting it is a compile
  // error — and `-c <cwd>` must ALWAYS reach tmux: without it, panes inherit
  // the tmux daemon's own cwd, which a deploy may have deleted.
  it("always passes -c with the given cwd to tmux new-session", async () => {
    await createSession("rdv-test-session", "/projects/app");

    const newSessionCall = execFileMock.mock.calls.find(
      ([, args]) => args?.[0] === "new-session",
    );
    expect(newSessionCall).toBeDefined();
    const [command, args] = newSessionCall!;
    expect(command).toBe("tmux");
    const cIndex = args!.indexOf("-c");
    expect(cIndex).toBeGreaterThan(-1);
    expect(args![cIndex + 1]).toBe("/projects/app");
  });

  it("passes -c alongside -e env injection", async () => {
    await createSession("rdv-test-session", "/projects/app", undefined, {
      FOO: "bar",
    });

    const newSessionCall = execFileMock.mock.calls.find(
      ([, args]) => args?.[0] === "new-session",
    );
    const [, args] = newSessionCall!;
    const cIndex = args!.indexOf("-c");
    expect(args![cIndex + 1]).toBe("/projects/app");
    expect(args).toContain("FOO=bar");
  });
});
