import { describe, it, expect } from "vitest";
import { getSessionIconColor } from "@/components/session/project-tree/sessionIconColor";
import type { TerminalSession } from "@/types/session";

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "s1",
    userId: "u1",
    name: "test",
    tmuxSessionName: "rdv-s1",
    projectPath: null,
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    projectId: null,
    profileId: null,
    terminalType: "shell",
    agentProvider: null,
    agentExitState: null,
    agentExitCode: null,
    agentExitedAt: null,
    agentRestartCount: 0,
    agentActivityStatus: null,
    typeMetadata: null,
    parentSessionId: null,
    status: "active",
    pinned: false,
    tabOrder: 0,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TerminalSession;
}

describe("getSessionIconColor", () => {
  it("agent session + status running → text-green-500 agent-breathing", () => {
    const session = makeSession({ terminalType: "agent" });
    const result = getSessionIconColor(session, false, () => "running");
    expect(result).toContain("text-green-500");
    expect(result).toContain("agent-breathing");
  });

  it("agent session + status waiting → text-yellow-500 agent-breathing", () => {
    const session = makeSession({ terminalType: "agent" });
    const result = getSessionIconColor(session, false, () => "waiting");
    expect(result).toContain("text-yellow-500");
    expect(result).toContain("agent-breathing");
  });

  it("agent session + status error → text-red-500 (no agent-breathing)", () => {
    const session = makeSession({ terminalType: "agent" });
    const result = getSessionIconColor(session, false, () => "error");
    expect(result).toContain("text-red-500");
    expect(result).not.toContain("agent-breathing");
  });

  it("non-agent session + isActive=true → text-primary", () => {
    const session = makeSession({ terminalType: "shell" });
    const result = getSessionIconColor(session, true, () => "idle");
    expect(result).toBe("text-primary");
  });

  it("non-agent session + isActive=false → text-muted-foreground", () => {
    const session = makeSession({ terminalType: "shell" });
    const result = getSessionIconColor(session, false, () => "idle");
    expect(result).toBe("text-muted-foreground");
  });
});
