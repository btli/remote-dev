// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createAgentServerPlugin } from "../agent-plugin-server";
import type { TerminalSession } from "@/types/session";

const plugin = createAgentServerPlugin();

const session = (over: {
  agentProvider?: TerminalSession["agentProvider"];
  typeMetadata?: Record<string, unknown> | null;
}): TerminalSession =>
  ({
    id: "s1",
    userId: "u1",
    name: "Agent",
    tmuxSessionName: "rdv-s1",
    projectPath: "/p",
    terminalType: "agent",
    agentProvider: over.agentProvider ?? "claude",
    typeMetadata: over.typeMetadata ?? null,
  }) as unknown as TerminalSession;

/**
 * [hgwo] onSessionRestart is intentionally INERT for resume: it returns the bare
 * provider command and ignores any resumeBinding. The live restart paths (HTTP
 * RestartAgentUseCase, WS restart_agent / relaunchAgentInTmux) own resume via
 * the AgentResumeResolver. These tests lock that contract so the dead path
 * cannot silently start relaunching with the wrong (original-launch) flags.
 */
describe("agent-plugin-server onSessionRestart — inert (no resume here)", () => {
  it("returns the bare command and ignores a resumeBinding.resumeFlags", async () => {
    const cfg = await plugin.onSessionRestart!(
      session({ typeMetadata: { resumeBinding: { resumeFlags: ["--resume", "x"] } } }),
    );
    expect(cfg?.shellCommand).toBe("claude");
  });

  it("returns the bare command and ignores a resumeBinding.argvOverride (codex)", async () => {
    const cfg = await plugin.onSessionRestart!(
      session({
        agentProvider: "codex",
        typeMetadata: { resumeBinding: { argvOverride: ["codex", "resume", "cx"] } },
      }),
    );
    expect(cfg?.shellCommand).toBe("codex");
  });

  it("returns the bare command when there is no binding", async () => {
    const cfg = await plugin.onSessionRestart!(session({ typeMetadata: null }));
    expect(cfg?.shellCommand).toBe("claude");
  });

  it("returns null for a none provider", async () => {
    const cfg = await plugin.onSessionRestart!(session({ agentProvider: "none" }));
    expect(cfg).toBeNull();
  });
});
