// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  buildAgentExitCallbackScript,
  buildAgentExitHookCommand,
} from "../agent-exit-hook";

describe("agent pane-exit hook", () => {
  it("sends authenticated status, signal, and generation with retryable curl", () => {
    const script = buildAgentExitCallbackScript({
      sessionId: "session-1",
      tmuxSessionName: "rdv-session-1",
      generation: 7,
      terminalSocket: "/tmp/rdv terminal.sock",
    });

    expect(script).toContain("RDV_API_KEY");
    expect(script).toContain('Authorization: Bearer $RDV_API_KEY');
    expect(script).toContain("generation=7");
    expect(script).toContain("exitCode=#{pane_dead_status}");
    expect(script).toContain("signal=#{pane_dead_signal}");
    expect(script).toContain("--retry 3");
    expect(script).toContain("--retry-all-errors");
    expect(script).toContain("--connect-timeout 1");
    expect(script).toContain("--max-time 2");
    expect(script).toContain("--retry-max-time 6");
    expect(script).toContain("--fail");
    expect(spawnSync("/bin/sh", ["-n", "-c", script]).status).toBe(0);
  });

  it("wraps the callback as one tmux run-shell command", () => {
    const command = buildAgentExitHookCommand({
      sessionId: "session-1",
      tmuxSessionName: "rdv-session-1",
      generation: 0,
      terminalPort: "6002",
    });
    expect(command).toMatch(/^run-shell /);
    expect(command).toContain("http://localhost:6002/internal/agent-exit");
  });
});
