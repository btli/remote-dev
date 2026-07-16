// @vitest-environment node
/**
 * [remote-dev-ipbo] Tests for the exec helpers' stable default spawn cwd.
 *
 * Children that inherit `process.cwd()` can be born inside a deploy-deleted
 * directory (Next.js standalone chdirs into `.next/standalone`); a tmux daemon
 * forked there keeps the dead inode forever and silently ignores `-c`. The
 * wrappers therefore default every child to STABLE_SPAWN_CWD (home, existence-
 * checked at load; "/" when home is missing or bogus).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import * as os from "node:os";

type ExecCallback = (
  err: unknown,
  result: { stdout: string; stderr: string },
) => void;

const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

import { execFile, execFileCapped, spawnProcess, STABLE_SPAWN_CWD } from "./exec";

/** Minimal fake ChildProcess: stdout/stderr emitters + close event. */
function fakeProc(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (signal?: string) => void;
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal?: string) => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe("STABLE_SPAWN_CWD", () => {
  it("is the (existing) home directory, or root as the fallback", () => {
    const home = os.homedir();
    if (home && existsSync(home)) {
      expect(STABLE_SPAWN_CWD).toBe(home);
    } else {
      expect(STABLE_SPAWN_CWD).toBe("/");
    }
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

describe("execFileCapped default cwd", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const proc = fakeProc();
      setImmediate(() => proc.emit("close", 0));
      return proc;
    });
  });

  it("defaults the child cwd to STABLE_SPAWN_CWD when the caller omits it", async () => {
    await execFileCapped("git", ["-C", "/projects/app", "status"]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const opts = spawnMock.mock.calls[0][2] as { cwd?: string };
    expect(opts.cwd).toBe(STABLE_SPAWN_CWD);
  });

  it("keeps the caller's explicit cwd when provided", async () => {
    await execFileCapped("git", ["status"], { cwd: "/projects/app" });

    const opts = spawnMock.mock.calls[0][2] as { cwd?: string };
    expect(opts.cwd).toBe("/projects/app");
  });
});

describe("spawnProcess default cwd", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const proc = fakeProc();
      setImmediate(() => proc.emit("close", 0));
      return proc;
    });
  });

  it("defaults the child cwd to STABLE_SPAWN_CWD when the caller omits it", async () => {
    await spawnProcess("sleep", ["0"]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const opts = spawnMock.mock.calls[0][2] as { cwd?: string };
    expect(opts.cwd).toBe(STABLE_SPAWN_CWD);
  });

  it("keeps the caller's explicit cwd when provided", async () => {
    await spawnProcess("sleep", ["0"], { cwd: "/projects/app" });

    const opts = spawnMock.mock.calls[0][2] as { cwd?: string };
    expect(opts.cwd).toBe("/projects/app");
  });
});
