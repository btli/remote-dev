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
const resolveVerifiedProviderExecutable = vi.fn();
vi.mock("@/services/agent-cli-service", () => ({ resolveVerifiedProviderExecutable }));

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
  resolveVerifiedProviderExecutable.mockReset().mockImplementation(
    async (_provider: string, command: string) => command,
  );
  vi.unstubAllEnvs();
  vi.doUnmock("@/infrastructure/agent-resume/AgentResumeResolverImpl");
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

  it("refuses to relaunch Cursor when agent is not Cursor's CLI", async () => {
    resolveVerifiedProviderExecutable.mockResolvedValue(null);
    mockAgentRow(fullRow({
      id: "cursor-1",
      terminalType: "agent",
      agentProvider: "cursor",
      projectPath: "/p",
      typeMetadata: "{}",
    }));

    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    await expect(
      relaunchAgentInTmux("cursor-1", "tmux-cursor"),
    ).rejects.toThrow("is not the Cursor Agent CLI");

    const [provider, command, launchEnv, cwd] =
      resolveVerifiedProviderExecutable.mock.calls[0];
    expect(provider).toBe("cursor");
    expect(command).toBe("agent");
    expect(launchEnv.PATH).toEqual(expect.any(String));
    expect(cwd).not.toBe("/p");
    expect(sendKeysArgs()).toBeUndefined();
  });

  it("launches Cursor by its verified absolute path", async () => {
    resolveVerifiedProviderExecutable.mockResolvedValue("/verified/cursor agent");
    mockAgentRow(fullRow({
      id: "cursor-2",
      terminalType: "agent",
      agentProvider: "cursor",
      projectPath: "/p",
      typeMetadata: JSON.stringify({ agentSessionId: { cursor: "chat-2" } }),
    }));

    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    const result = await relaunchAgentInTmux("cursor-2", "tmux-cursor");

    expect(result).toEqual({ resumed: true });
    expect(sendKeysArgs()![4]).toBe("'/verified/cursor agent' --resume chat-2");
  });

  it("relaunches a Cursor loop row after tmux recreation", async () => {
    resolveVerifiedProviderExecutable.mockResolvedValue("/verified/cursor-agent");
    mockAgentRow(fullRow({
      id: "cursor-loop",
      terminalType: "loop",
      agentProvider: "cursor",
      projectPath: "/p",
      typeMetadata: JSON.stringify({ agentSessionId: { cursor: "loop-chat" } }),
    }));

    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    const result = await relaunchAgentInTmux("cursor-loop", "tmux-loop");

    expect(result).toEqual({ resumed: true });
    expect(sendKeysArgs()![4]).toBe(
      "'/verified/cursor-agent' --resume loop-chat",
    );
  });

  it("revalidates Cursor's persisted executable and falls back from a deleted cwd", async () => {
    resolveVerifiedProviderExecutable.mockResolvedValue("/folder/bin/agent");
    mockAgentRow(fullRow({
      id: "cursor-persisted",
      terminalType: "agent",
      agentProvider: "cursor",
      projectPath: "/definitely/deleted/worktree",
      typeMetadata: JSON.stringify({
        resumeBinding: { executablePath: "/folder/bin/agent", env: {} },
      }),
    }));

    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    await relaunchAgentInTmux("cursor-persisted", "tmux-cursor");

    const [provider, command, launchEnv, cwd] =
      resolveVerifiedProviderExecutable.mock.calls[0];
    expect(provider).toBe("cursor");
    expect(command).toBe("/folder/bin/agent");
    expect(launchEnv.PATH).toEqual(expect.any(String));
    expect(cwd).not.toContain("/definitely/deleted/worktree");
  });

  it("passes process-level CURSOR_DATA_DIR to cold-relaunch discovery", async () => {
    vi.stubEnv("CURSOR_DATA_DIR", "/srv/cursor-data");
    const resolveResume = vi.fn().mockResolvedValue(null);
    vi.doMock("@/infrastructure/agent-resume/AgentResumeResolverImpl", () => ({
      AgentResumeResolverImpl: class {
        resolveResume = resolveResume;
      },
    }));
    resolveVerifiedProviderExecutable.mockResolvedValue("/verified/cursor-agent");
    mockAgentRow(fullRow({
      id: "cursor-3",
      terminalType: "agent",
      agentProvider: "cursor",
      projectPath: "/p",
      typeMetadata: "{}",
    }));

    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    await relaunchAgentInTmux("cursor-3", "tmux-cursor");

    expect(resolveResume).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ CURSOR_DATA_DIR: "/srv/cursor-data" }),
    );
    expect(setEnvArgs("CURSOR_DATA_DIR")).toEqual([
      "set-environment",
      "-t",
      "tmux-cursor",
      "CURSOR_DATA_DIR",
      "/srv/cursor-data",
    ]);
    expect(sendKeysArgs()![4]).toBe(
      "CURSOR_DATA_DIR='/srv/cursor-data' '/verified/cursor-agent'",
    );
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
    expect(sendKeysArgs()![4]).toContain("CLAUDE_CONFIG_DIR='/profiles/p1/.config' claude");
  });

  it("rejects when the relaunch command cannot be sent", async () => {
    mockAgentRow(fullRow({
      id: "send-failure",
      terminalType: "agent",
      agentProvider: "claude",
      projectPath: "/p",
      typeMetadata: "{}",
    }));
    execFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        optsOrCb: unknown,
        maybeCb?: (e: unknown, r: unknown) => void,
      ) => {
        const cb = (typeof optsOrCb === "function" ? optsOrCb : maybeCb) as (
          e: unknown,
          r: unknown,
        ) => void;
        cb(new Error("tmux send failed"), undefined);
      },
    );

    const { relaunchAgentInTmux } = await import("../agent-relaunch");
    await expect(
      relaunchAgentInTmux("send-failure", "tmux-x"),
    ).rejects.toThrow("tmux send failed");
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
