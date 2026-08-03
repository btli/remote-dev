// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  return {
    events,
    respawnPane: vi.fn(async () => {
      events.push("respawn");
      return "%7";
    }),
    getSessionEnvironment: vi.fn(async () => ({
      RDV_SESSION_ID: "session-1",
      RDV_USER_ID: "user-1",
      RDV_AGENT_GENERATION: "3",
      RDV_API_KEY: "rdv_test",
      RDV_TERMINAL_PORT: "6002",
      RDV_AGENT_PROVIDER: "codex",
    })),
    prepareAgentLaunch: vi.fn(async () => {
      events.push("prepare");
    }),
    configureAgentPaneLifecycle: vi.fn(async (
      _sessionName: string,
      _hookCommand: string,
      _targetPane?: string,
    ) => {
      events.push("configure");
    }),
    launchCommand: vi.fn(async () => {
      events.push("launch");
    }),
  };
});

vi.mock("@/services/tmux-service", () => ({
  ...mocks,
  createSession: vi.fn(),
  killSession: vi.fn(),
  sessionExists: vi.fn(),
  getSessionPresence: vi.fn(),
  stopSessionAndConfirmAbsent: vi.fn(),
  listSessions: vi.fn(),
  setSessionEnvironment: vi.fn(),
  getSessionEnvironment: mocks.getSessionEnvironment,
  unsetSessionEnvironment: vi.fn(),
  setHook: vi.fn(),
  removeHook: vi.fn(),
  setOption: vi.fn(),
  getOption: vi.fn(),
  generateSessionName: vi.fn(),
}));
vi.mock("@/services/agent-launch-preparation", () => ({
  prepareAgentLaunch: mocks.prepareAgentLaunch,
}));
import { TmuxGatewayImpl } from "./TmuxGatewayImpl";

describe("TmuxGatewayImpl agent restart", () => {
  beforeEach(() => {
    mocks.events.length = 0;
    vi.clearAllMocks();
  });

  it("respawns the pane and binds the fresh generation before exec", async () => {
    await new TmuxGatewayImpl().replaceAgentProcess("rdv-session-1", "codex resume abc");

    expect(mocks.events).toEqual(["respawn", "prepare", "configure", "launch"]);
    expect(mocks.prepareAgentLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        RDV_AGENT_PROVIDER: "codex",
        RDV_AGENT_GENERATION: "3",
      }),
    );
    expect(mocks.launchCommand).toHaveBeenCalledWith(
      "rdv-session-1",
      "codex resume abc",
      { replaceShell: true, targetPane: "%7" },
    );
    expect(mocks.configureAgentPaneLifecycle.mock.calls[0]?.[1]).toContain(
      "generation=3",
    );
    expect(mocks.configureAgentPaneLifecycle.mock.calls[0]?.[2]).toBe("%7");
  });

  it("does not leave the prior agent running when launch preparation fails", async () => {
    mocks.prepareAgentLaunch.mockRejectedValueOnce(new Error("invalid hooks"));

    await expect(
      new TmuxGatewayImpl().replaceAgentProcess("rdv-session-1", "codex"),
    ).rejects.toThrow("invalid hooks");

    expect(mocks.events).toEqual(["respawn"]);
    expect(mocks.configureAgentPaneLifecycle).not.toHaveBeenCalled();
    expect(mocks.launchCommand).not.toHaveBeenCalled();
  });
});
