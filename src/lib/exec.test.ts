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

type ExecCallback = (
  err: unknown,
  result: { stdout: string; stderr: string },
) => void;

const FAKE_HOME = "/home/spawn-tester";

const { execFileMock, spawnMock, homedirMock, existsSyncMock } = vi.hoisted(() => {
  const homedirMock = vi.fn(() => "/home/spawn-tester");
  const existsSyncMock = vi.fn(() => true);
  return { execFileMock: vi.fn(), spawnMock: vi.fn(), homedirMock, existsSyncMock };
});

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

// STABLE_SPAWN_CWD is computed once at module load from os.homedir() +
// existsSync, so pin both: the tests below assert the invariant (homedir when
// non-empty and existing, "/" otherwise) instead of mirroring the real
// environment's branch.
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: homedirMock,
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: existsSyncMock,
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
  it("is the home directory when it is non-empty and exists", () => {
    expect(STABLE_SPAWN_CWD).toBe(FAKE_HOME);
  });

  it("is a non-empty absolute path", () => {
    expect(STABLE_SPAWN_CWD.length).toBeGreaterThan(0);
    expect(STABLE_SPAWN_CWD.startsWith("/")).toBe(true);
  });

  it("falls back to '/' when the home directory does not exist", async () => {
    // Recomputed at module load — re-evaluate the module under the scenario.
    vi.resetModules();
    existsSyncMock.mockReturnValueOnce(false);
    const mod = await import("./exec");
    expect(mod.STABLE_SPAWN_CWD).toBe("/");
  });

  it("falls back to '/' when the homedir is empty", async () => {
    vi.resetModules();
    homedirMock.mockReturnValueOnce("");
    const mod = await import("./exec");
    expect(mod.STABLE_SPAWN_CWD).toBe("/");
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
