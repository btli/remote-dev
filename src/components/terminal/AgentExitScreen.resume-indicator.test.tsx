import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentExitScreen } from "./AgentExitScreen";

/**
 * [hgwo] The exit screen hints whether a Restart will resume the conversation,
 * based on the provider's resume capability.
 */
describe("AgentExitScreen — resume capability hint", () => {
  const base = {
    sessionId: "s1",
    sessionName: "agent",
    exitCode: 0,
    exitedAt: new Date().toISOString(),
    restartCount: 0,
    onRestart: vi.fn(),
    onClose: vi.fn(),
  };

  it("shows the resume hint for a resume-capable provider (claude)", () => {
    render(<AgentExitScreen {...base} agentProvider="claude" />);
    expect(screen.getByText(/resumes the prior conversation/i)).toBeTruthy();
  });

  it("shows the resume hint for codex", () => {
    render(<AgentExitScreen {...base} agentProvider="codex" />);
    expect(screen.getByText(/resumes the prior conversation/i)).toBeTruthy();
  });

  it("shows an unsupported hint for antigravity (no resume)", () => {
    render(<AgentExitScreen {...base} agentProvider="antigravity" />);
    expect(screen.getByText(/does not support resume/i)).toBeTruthy();
  });

  it("defaults to the resume hint when provider is unknown/null", () => {
    render(<AgentExitScreen {...base} agentProvider={null} />);
    expect(screen.getByText(/resumes the prior conversation/i)).toBeTruthy();
  });
});
