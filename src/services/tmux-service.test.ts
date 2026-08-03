// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/exec", () => ({
  execFile: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  execFileCheck: vi.fn(async () => true),
  // exitCode 1 = `tmux has-session` says the session does NOT exist yet.
  execFileNoThrow: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 1 })),
}));

import { execFile, execFileNoThrow } from "@/lib/exec";
import {
  configureAgentPaneLifecycle,
  createSession,
  getSessionPresence,
  launchCommand,
  respawnPane,
  resolveStartupEnv,
} from "./tmux-service";

const execFileMock = vi.mocked(execFile);
const execFileNoThrowMock = vi.mocked(execFileNoThrow);

describe("getSessionPresence", () => {
  it("distinguishes confirmed presence, confirmed absence, and probe failure", async () => {
    execFileNoThrowMock.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    await expect(getSessionPresence("live")).resolves.toBe("present");

    execFileNoThrowMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "can't find session: gone",
      exitCode: 1,
    });
    await expect(getSessionPresence("gone")).resolves.toBe("absent");

    execFileNoThrowMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "error connecting to /tmp/tmux: Permission denied",
      exitCode: 1,
    });
    await expect(getSessionPresence("uncertain")).resolves.toBe("unknown");
  });
});

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

  // [remote-dev-307w] The Claude setup-token flow needs a wide detached pane:
  // without -x/-y, tmux defaults a detached session to 80×24 and the TUI clips
  // the ~108-char token at the pane edge.
  it("passes -x/-y when initial dimensions are given", async () => {
    await createSession("rdv-test-session", "/projects/app", undefined, undefined, 50000, {
      cols: 220,
      rows: 50,
    });

    const newSessionCall = execFileMock.mock.calls.find(
      ([, args]) => args?.[0] === "new-session",
    );
    const [, args] = newSessionCall!;
    const xIndex = args!.indexOf("-x");
    expect(xIndex).toBeGreaterThan(-1);
    expect(args![xIndex + 1]).toBe("220");
    const yIndex = args!.indexOf("-y");
    expect(args![yIndex + 1]).toBe("50");
  });

  it("omits -x/-y when no dimensions are given, leaving tmux's default", async () => {
    await createSession("rdv-test-session", "/projects/app");

    const newSessionCall = execFileMock.mock.calls.find(
      ([, args]) => args?.[0] === "new-session",
    );
    const [, args] = newSessionCall!;
    expect(args).not.toContain("-x");
    expect(args).not.toContain("-y");
  });

  it("ignores non-integer or non-positive dimensions instead of failing the create", async () => {
    await createSession("rdv-test-session", "/projects/app", undefined, undefined, 50000, {
      cols: 0,
      rows: 24.5,
    });

    const newSessionCall = execFileMock.mock.calls.find(
      ([, args]) => args?.[0] === "new-session",
    );
    const [, args] = newSessionCall!;
    expect(args).not.toContain("-x");
    expect(args).not.toContain("-y");
  });
});

describe("launchCommand", () => {
  beforeEach(() => {
    execFileMock.mockClear();
    execFileMock.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("execs an agent command so the agent owns the pane lifetime", async () => {
    execFileNoThrowMock.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    await launchCommand("rdv-test-session", "codex --no-alt-screen", {
      replaceShell: true,
    });

    const literal = execFileMock.mock.calls.find(
      ([, args]) => args?.[0] === "send-keys" && args.includes("-l"),
    );
    expect(literal?.[1]).toEqual([
      "send-keys",
      "-t",
      "rdv-test-session",
      "-l",
      "--",
      "exec codex --no-alt-screen",
    ]);
  });

  it("binds remain-on-exit and pane-died to the exact agent pane", async () => {
    execFileNoThrowMock.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    execFileMock.mockResolvedValue({ stdout: "%7\t\n", stderr: "", exitCode: 0 });
    await configureAgentPaneLifecycle("rdv-test-session", "run-shell 'notify-rdv'");

    expect(execFileMock).toHaveBeenCalledWith("tmux", [
      "set-option",
      "-p",
      "-t",
      "%7",
      "remain-on-exit",
      "on",
    ]);
    expect(execFileMock).toHaveBeenCalledWith("tmux", [
      "set-option",
      "-p",
      "-t",
      "%7",
      "@rdv_agent_pane",
      "1",
    ]);
    expect(execFileMock).toHaveBeenCalledWith("tmux", [
      "set-hook",
      "-p",
      "-t",
      "%7",
      "pane-died",
      "run-shell 'notify-rdv'",
    ]);
  });

  it("respawns the pane before an intentional agent restart", async () => {
    execFileNoThrowMock.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    execFileMock.mockResolvedValue({ stdout: "%7\t1\n", stderr: "", exitCode: 0 });
    await respawnPane("rdv-test-session");
    expect(execFileMock).toHaveBeenCalledWith("tmux", [
      "respawn-pane",
      "-k",
      "-t",
      "%7",
    ]);
  });
});
