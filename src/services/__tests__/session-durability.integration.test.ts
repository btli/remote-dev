// @vitest-environment node
/**
 * [hgwo.8] Conversation-durability matrix: each failure mode × each provider.
 *
 * Failure modes & how they're simulated (drive the units; no real tmux/process):
 *   - WS disconnect        → tmux + agent survive → relaunch is NOT invoked.
 *   - Suspend / resume     → tmux + agent survive → same as WS disconnect.
 *   - Terminal-server restart → tmux gone on reconnect → relaunch RESUMED.
 *   - Tmux death / pod restart → tmux gone + binding env → set-environment
 *     for future processes, then send-keys with inline env assignments so the
 *     existing shell launches "<cmd> --resume <id>" with the same binding.
 *
 * The first two modes are structural properties of terminal.ts: the attach
 * branch (`tmuxExists === true`) reattaches the surviving PTY and never calls
 * relaunchAgentInTmux. We assert the resolver/relaunch contract for the latter
 * two and the graceful-fresh path for antigravity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/agent-cli-service", () => ({
  resolveVerifiedProviderExecutable: vi.fn(
    async (provider: string, command: string) =>
      provider === "cursor" ? "/verified/cursor-agent" : command,
  ),
}));

const execFileCalls: string[][] = [];
const createApiKey = vi.fn().mockResolvedValue({ key: "rdv_durability_key" });
const markAgentRunning = vi.fn().mockResolvedValue({ id: "running" });
const markAgentExited = vi.fn().mockResolvedValue({ id: "exited" });
const markAgentRestarting = vi.fn().mockResolvedValue({ agentRestartCount: 1 });
const prepareAgentLaunch = vi.fn().mockResolvedValue(undefined);
// Accept both call shapes: (cmd, args, cb) and (cmd, args, opts, cb) — the
// relaunch sites pass { cwd: STABLE_SPAWN_CWD } (remote-dev-ipbo).
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
    cb(null, {
      stdout: args[0] === "list-panes" ? "%7\t\n" : "",
      stderr: "",
    });
  },
);
vi.mock("node:child_process", () => ({ execFile }));

beforeEach(() => {
  execFileCalls.length = 0;
  execFile.mockClear();
  createApiKey.mockClear();
  markAgentRunning.mockClear();
  markAgentExited.mockClear();
  markAgentRestarting.mockClear();
  prepareAgentLaunch.mockClear();
  vi.resetModules();
});

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

function mockRow(row: Record<string, unknown> | null) {
  vi.doMock("@/db", () => ({
    db: {
      query: { terminalSessions: { findFirst: vi.fn().mockResolvedValue(row) } },
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    },
  }));
  vi.doMock("@/db/schema", () => ({
    terminalSessions: { id: "id" },
    apiKeys: { userId: "userId", name: "name" },
  }));
  vi.doMock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
  vi.doMock("@/services/api-key-service", () => ({ createApiKey }));
  vi.doMock("@/services/session-service", () => ({
    markAgentRestarting,
    markAgentRunning,
    markAgentExited,
  }));
  vi.doMock("@/services/agent-launch-preparation", () => ({ prepareAgentLaunch }));
}

const sendKeys = () => execFileCalls.find((a) => a.includes("send-keys") && a.includes("-l"));
const enter = () => execFileCalls.find((a) => a.includes("send-keys") && a.includes("C-m"));
const setEnv = (k: string) =>
  execFileCalls.find((a) => a.includes("set-environment") && a.includes(k));

const RESUMABLE = ["claude", "codex", "gemini", "opencode", "cursor"] as const;

describe.each(RESUMABLE)("durability for %s", (provider) => {
  it("terminal-server restart: relaunches RESUMED when tmux is gone (stored id)", async () => {
    mockRow(
      fullRow({
        agentProvider: provider,
        typeMetadata: JSON.stringify({ agentSessionId: { [provider]: "nid-1" } }),
      }),
    );
    const { relaunchAgentInTmux } = await import("@/server/agent-relaunch");
    const { resumed } = await relaunchAgentInTmux(
      "123e4567-e89b-12d3-a456-426614174000",
      "tmux-s1",
    );

    expect(resumed).toBe(true);
    const cmd = sendKeys()![4];
    if (provider === "codex") {
      expect(cmd).toBe("exec codex resume nid-1");
    } else {
      expect(cmd).toMatch(/^exec .*?(--resume|--session) nid-1/);
    }
    // submitted with carriage return, not \n
    expect(enter()).toEqual(["send-keys", "-t", "%7", "C-m"]);
  });

  it("pod restart: re-injects binding env BEFORE relaunching resumed", async () => {
    mockRow(
      fullRow({
        agentProvider: provider,
        typeMetadata: JSON.stringify({
          agentSessionId: { [provider]: "nid-2" },
          resumeBinding: { provider, env: { XDG_CONFIG_HOME: "/cfg" } },
        }),
      }),
    );
    const { relaunchAgentInTmux } = await import("@/server/agent-relaunch");
    await relaunchAgentInTmux("123e4567-e89b-12d3-a456-426614174000", "tmux-s1");

    const envCall = setEnv("XDG_CONFIG_HOME");
    expect(envCall).toBeDefined();
    const envIdx = execFileCalls.indexOf(envCall!);
    const sendIdx = execFileCalls.indexOf(sendKeys()!);
    expect(envIdx).toBeLessThan(sendIdx);
    // The pane owner inherits the tmux session environment established above;
    // keep the launch command itself exact so provider executable matching and
    // process replacement are not obscured by an inline env prefix.
    expect(sendKeys()![4]).toMatch(/^exec /);
    expect(sendKeys()![4]).not.toContain("XDG_CONFIG_HOME=");
  });
});

describe("durability for antigravity (no resume support)", () => {
  it("relaunches FRESH and reports resumed=false", async () => {
    mockRow(fullRow({ agentProvider: "antigravity", typeMetadata: "{}" }));
    const { relaunchAgentInTmux } = await import("@/server/agent-relaunch");
    const { resumed } = await relaunchAgentInTmux(
      "123e4567-e89b-12d3-a456-426614174000",
      "tmux-s2",
    );
    expect(resumed).toBe(false);
    expect(sendKeys()![4]).toBe("exec agy"); // fresh agent owns the pane
  });
});

describe("WS disconnect / suspend-resume (tmux + agent survive)", () => {
  it("does NOT relaunch a non-agent row (attach-branch analog: no recreate)", async () => {
    // The attach branch in terminal.ts (tmuxExists===true) never invokes the
    // relaunch helper. The helper itself is a no-op for any non-recreate call;
    // we assert it sends nothing when there is nothing to relaunch.
    mockRow(fullRow({ terminalType: "shell" }));
    const { relaunchAgentInTmux } = await import("@/server/agent-relaunch");
    const { resumed } = await relaunchAgentInTmux(
      "123e4567-e89b-12d3-a456-426614174000",
      "tmux-s3",
    );
    expect(resumed).toBe(false);
    expect(sendKeys()).toBeUndefined();
  });
});
