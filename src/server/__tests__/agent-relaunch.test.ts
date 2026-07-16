// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * agent-relaunch.ts is the single recreate-site relaunch helper. It uses
 * node:child_process execFile (promisified) for tmux set-environment +
 * send-keys, and dynamically imports @/db + SessionMapper + the resolver.
 *
 * We mock node:child_process so execFile invokes its callback (promisify
 * resolves), and capture every tmux invocation. The @/db row + resolver are
 * doMock'd per case (resetModules first) because the helper imports them
 * dynamically inside the function body.
 */

// Capture every tmux call. Accepts both call shapes: (cmd, args, cb) and
// (cmd, args, opts, cb) — the relaunch sites pass { cwd: STABLE_SPAWN_CWD }
// (remote-dev-ipbo). cb(null, {stdout,stderr}).
const execFileCalls: string[][] = [];
const execFile = vi.fn(
  (
    _cmd: string,
    args: string[],
    optsOrCb: unknown,
    maybeCb?: (e: unknown, r: unknown) => void,
  ) => {
    const cb = (typeof optsOrCb === "function" ? optsOrCb : maybeCb) as (
      e: unknown,
      r: unknown,
    ) => void;
    execFileCalls.push(args);
    cb(null, { stdout: "", stderr: "" });
  },
);
vi.mock("node:child_process", () => ({ execFile }));

beforeEach(() => {
  execFileCalls.length = 0;
  execFile.mockClear();
  vi.resetModules();
});

/** A DB row complete enough for SessionMapper.toDomain to reconstitute. */
function fullRow(over: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  return {
    id: "123e4567-e89b-12d3-a456-426614174000",
    userId: "u1",
    name: "Agent",
    tmuxSessionName: "rdv-123e4567-e89b-12d3-a456-426614174000",
    status: "active",
    projectPath: "/p",
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    projectId: null,
    profileId: null,
    terminalType: "agent",
    agentProvider: "claude",
    agentExitState: "running",
    agentExitCode: null,
    agentExitedAt: null,
    agentRestartCount: 0,
    agentActivityStatus: null,
    typeMetadata: null,
    parentSessionId: null,
    pinned: false,
    tabOrder: 0,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function mockAgentRow(row: Record<string, unknown> | null) {
  vi.doMock("@/db", () => ({
    db: { query: { terminalSessions: { findFirst: vi.fn().mockResolvedValue(row) } } },
  }));
  vi.doMock("@/db/schema", () => ({ terminalSessions: { id: "id" } }));
  vi.doMock("drizzle-orm", () => ({ eq: vi.fn() }));
}

const sendKeysArgs = () => execFileCalls.find((a) => a.includes("send-keys") && a.includes("-l"));
const enterArgs = () => execFileCalls.find((a) => a.includes("send-keys") && a.includes("C-m"));
const setEnvArgs = (key: string) =>
  execFileCalls.find((a) => a.includes("set-environment") && a.includes(key));

describe("relaunchAgentInTmux — resume", () => {
  it("relaunches claude RESUMED with --resume <stored id> and submits with C-m", async () => {
    mockAgentRow(fullRow({
      id: "s1",
      terminalType: "agent",
      agentProvider: "claude",
      projectPath: "/p",
      typeMetadata: JSON.stringify({ agentSessionId: { claude: "id9" } }),
    }));
    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    const { resumed } = await relaunchAgentInTmux("s1", "tmux-x");

    expect(resumed).toBe(true);
    expect(sendKeysArgs()).toEqual(["send-keys", "-t", "tmux-x", "-l", "claude --resume id9"]);
    expect(enterArgs()).toEqual(["send-keys", "-t", "tmux-x", "C-m"]);
  });

  it("relaunches codex RESUMED via the resume subcommand argv", async () => {
    mockAgentRow(fullRow({
      id: "s1",
      terminalType: "agent",
      agentProvider: "codex",
      projectPath: "/p",
      typeMetadata: JSON.stringify({ agentSessionId: { codex: "cx" } }),
    }));
    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    const { resumed } = await relaunchAgentInTmux("s1", "tmux-x");

    expect(resumed).toBe(true);
    expect(sendKeysArgs()![4]).toBe("codex resume cx");
  });

  it("relaunches FRESH (no flags) and reports resumed=false for antigravity", async () => {
    mockAgentRow(fullRow({
      id: "s2",
      terminalType: "agent",
      agentProvider: "antigravity",
      projectPath: "/p",
      typeMetadata: "{}",
    }));
    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    const { resumed } = await relaunchAgentInTmux("s2", "tmux-y");

    expect(resumed).toBe(false);
    expect(sendKeysArgs()![4]).toBe("agy"); // bare command, no flags
  });

  it("no-ops for a non-agent row", async () => {
    mockAgentRow(fullRow({ id: "s3", terminalType: "shell" }));
    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    const { resumed } = await relaunchAgentInTmux("s3", "tmux-z");
    expect(resumed).toBe(false);
    expect(sendKeysArgs()).toBeUndefined();
  });

  it("no-ops when the row is missing", async () => {
    mockAgentRow(null);
    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    const { resumed } = await relaunchAgentInTmux("missing", "tmux-z");
    expect(resumed).toBe(false);
  });
});

describe("relaunchAgentInTmux — pod-restart env re-injection (hgwo.5)", () => {
  it("set-environment from the binding env BEFORE send-keys", async () => {
    mockAgentRow(fullRow({
      id: "s1",
      terminalType: "agent",
      agentProvider: "claude",
      projectPath: "/p",
      typeMetadata: JSON.stringify({
        agentSessionId: { claude: "id9" },
        resumeBinding: { env: { CLAUDE_CONFIG_DIR: "/profiles/p1/.config" } },
      }),
    }));
    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    await relaunchAgentInTmux("s1", "tmux-x");

    const envCall = setEnvArgs("CLAUDE_CONFIG_DIR");
    expect(envCall).toEqual([
      "set-environment",
      "-t",
      "tmux-x",
      "CLAUDE_CONFIG_DIR",
      "/profiles/p1/.config",
    ]);
    // env injection must precede the send-keys launch
    const envIdx = execFileCalls.indexOf(envCall!);
    const sendIdx = execFileCalls.indexOf(sendKeysArgs()!);
    expect(envIdx).toBeGreaterThanOrEqual(0);
    expect(envIdx).toBeLessThan(sendIdx);
  });
});

describe("relaunchAgentInTmux — concurrency guard (hgwo.5)", () => {
  it("fires send-keys exactly once when invoked concurrently", async () => {
    mockAgentRow(fullRow({
      id: "s1",
      terminalType: "agent",
      agentProvider: "claude",
      projectPath: "/p",
      typeMetadata: JSON.stringify({ agentSessionId: { claude: "id9" } }),
    }));
    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    const [a, b] = await Promise.all([
      relaunchAgentInTmux("s1", "tmux-x"),
      relaunchAgentInTmux("s1", "tmux-x"),
    ]);
    const sends = execFileCalls.filter((c) => c.includes("send-keys") && c.includes("-l"));
    expect(sends).toHaveLength(1);
    // exactly one of the two calls performed the relaunch
    expect([a.resumed, b.resumed].filter(Boolean)).toHaveLength(1);
  });
});
