// @vitest-environment node
/**
 * [hgwo.8] Conversation-durability matrix: each failure mode × each provider.
 *
 * Failure modes & how they're simulated (drive the units; no real tmux/process):
 *   - WS disconnect        → tmux + agent survive → relaunch is NOT invoked.
 *   - Suspend / resume     → tmux + agent survive → same as WS disconnect.
 *   - Terminal-server restart → tmux gone on reconnect → relaunch RESUMED.
 *   - Tmux death / pod restart → tmux gone + binding env → set-environment
 *     then send-keys "<cmd> --resume <id>" submitted with C-m.
 *
 * The first two modes are structural properties of terminal.ts: the attach
 * branch (`tmuxExists === true`) reattaches the surviving PTY and never calls
 * relaunchAgentInTmux. We assert the resolver/relaunch contract for the latter
 * two and the graceful-fresh path for antigravity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileCalls: string[][] = [];
const execFile = vi.fn(
  (_cmd: string, args: string[], cb: (e: unknown, r: unknown) => void) => {
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
    db: { query: { terminalSessions: { findFirst: vi.fn().mockResolvedValue(row) } } },
  }));
  vi.doMock("@/db/schema", () => ({ terminalSessions: { id: "id" } }));
  vi.doMock("drizzle-orm", () => ({ eq: vi.fn() }));
}

const sendKeys = () => execFileCalls.find((a) => a.includes("send-keys") && a.includes("-l"));
const enter = () => execFileCalls.find((a) => a.includes("send-keys") && a.includes("C-m"));
const setEnv = (k: string) =>
  execFileCalls.find((a) => a.includes("set-environment") && a.includes(k));

const RESUMABLE = ["claude", "codex", "gemini", "opencode"] as const;

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
      expect(cmd).toBe("codex resume nid-1");
    } else {
      expect(cmd).toMatch(/(--resume|--session) nid-1/);
    }
    // submitted with carriage return, not \n
    expect(enter()).toEqual(["send-keys", "-t", "tmux-s1", "C-m"]);
  });

  it("pod restart: re-injects binding env BEFORE relaunching resumed", async () => {
    mockRow(
      fullRow({
        agentProvider: provider,
        typeMetadata: JSON.stringify({
          agentSessionId: { [provider]: "nid-2" },
          resumeBinding: { provider, env: { CLAUDE_CONFIG_DIR: "/cfg", CODEX_HOME: "/cfg" } },
        }),
      }),
    );
    const { relaunchAgentInTmux } = await import("@/server/agent-relaunch");
    await relaunchAgentInTmux("123e4567-e89b-12d3-a456-426614174000", "tmux-s1");

    const envCall = setEnv("CLAUDE_CONFIG_DIR") ?? setEnv("CODEX_HOME");
    expect(envCall).toBeDefined();
    const envIdx = execFileCalls.indexOf(envCall!);
    const sendIdx = execFileCalls.indexOf(sendKeys()!);
    expect(envIdx).toBeLessThan(sendIdx);
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
    expect(sendKeys()![4]).toBe("agy"); // fresh agy, no flags
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
