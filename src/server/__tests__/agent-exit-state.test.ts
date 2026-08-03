import { describe, expect, it } from "vitest";

import {
  agentExitStateUpdate,
  agentExitTransition,
  parseAgentExitCode,
  parseAgentExitSignal,
} from "../agent-exit-state";

describe("agent exit state", () => {
  it("parses only finite integer exit codes", () => {
    expect(parseAgentExitCode("0")).toBe(0);
    expect(parseAgentExitCode("17")).toBe(17);
    expect(parseAgentExitCode("-1")).toBe(-1);
    expect(parseAgentExitCode(undefined)).toBeNull();
    expect(parseAgentExitCode("not-a-number")).toBeNull();
    expect(parseAgentExitCode("1.5")).toBeNull();
  });

  it("parses tmux signal names without accepting query-string garbage", () => {
    expect(parseAgentExitSignal("term")).toBe("term");
    expect(parseAgentExitSignal("KILL")).toBe("kill");
    expect(parseAgentExitSignal("")).toBeNull();
    expect(parseAgentExitSignal("term&status=0")).toBeNull();
    expect(parseAgentExitSignal(undefined)).toBeNull();
  });

  it("maps clean process exit to ended and code/signal failures to error", () => {
    expect(agentExitTransition(0, null)).toEqual({ status: "ended", failed: false });
    expect(agentExitTransition(1, null)).toEqual({ status: "error", failed: true });
    expect(agentExitTransition(-1, null)).toEqual({ status: "error", failed: true });
    expect(agentExitTransition(null, "term")).toEqual({ status: "error", failed: true });
    expect(agentExitTransition(null, "kill")).toEqual({ status: "error", failed: true });
    expect(() => agentExitTransition(null, null)).toThrow(/missing exit code and signal/i);
  });

  it("builds the authoritative durable update from the pane exit", () => {
    const statusAt = Date.UTC(2026, 7, 3, 12, 0, 0);
    const exitedAt = new Date(statusAt);

    expect(agentExitStateUpdate(9, null, statusAt)).toEqual({
      agentExitState: "exited",
      agentExitCode: 9,
      agentExitedAt: exitedAt,
      agentExitNotificationAt: null,
      agentActivityStatus: "error",
      agentActivityStatusAt: statusAt,
      agentActivityOrder: statusAt * 1_000,
      updatedAt: exitedAt,
    });
  });
});
