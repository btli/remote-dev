// @vitest-environment node
/**
 * [remote-dev-ipbo] Tests for the exec helpers' stable default spawn cwd.
 *
 * Children that inherit `process.cwd()` can be born inside a deploy-deleted
 * directory (Next.js standalone chdirs into `.next/standalone`); a tmux daemon
 * forked there keeps the dead inode forever and silently ignores `-c`. The
 * wrapper therefore defaults every child to STABLE_SPAWN_CWD (home).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as os from "node:os";

type ExecCallback = (
  err: unknown,
  result: { stdout: string; stderr: string },
) => void;

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: vi.fn(),
}));

import { execFile, STABLE_SPAWN_CWD } from "./exec";

describe("STABLE_SPAWN_CWD", () => {
  it("is the home directory (or root when home is unavailable)", () => {
    expect(STABLE_SPAWN_CWD).toBe(os.homedir() || "/");
    expect(STABLE_SPAWN_CWD.length).toBeGreaterThan(0);
  });
});

describe("execFile default cwd", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: ExecCallback,
      ) => {
        cb(null, { stdout: "ok", stderr: "" });
      },
    );
  });

  it("defaults the child cwd to STABLE_SPAWN_CWD when the caller omits it", async () => {
    await execFile("tmux", ["-V"]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const opts = execFileMock.mock.calls[0][2] as { cwd?: string };
    expect(opts.cwd).toBe(STABLE_SPAWN_CWD);
  });

  it("keeps the caller's explicit cwd when provided", async () => {
    await execFile("git", ["status"], { cwd: "/projects/app" });

    const opts = execFileMock.mock.calls[0][2] as { cwd?: string };
    expect(opts.cwd).toBe("/projects/app");
  });
});
