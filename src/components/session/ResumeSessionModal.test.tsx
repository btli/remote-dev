import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ResumeSessionModal } from "./ResumeSessionModal";

/**
 * [hgwo] The resume picker is multi-provider: it calls the generic
 * `/api/agent/sessions?provider=…` route for the session's agent (not the
 * Claude-only route), renders Claude's rich previews when present, degrades to
 * id + timestamp for disk-discovery providers, and skips the fetch entirely for
 * providers that can't resume.
 */

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

const base = {
  open: true,
  onClose: vi.fn(),
  projectPath: "/proj",
  onResume: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  apiFetch.mockReset();
});

describe("ResumeSessionModal — multi-provider discovery", () => {
  it("defaults to Claude and renders its rich preview", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse({
        provider: "claude",
        sessions: [
          {
            sessionId: "claude-uuid-1",
            lastModified: new Date().toISOString(),
            firstUserMessage: "fix the bug",
            gitBranch: "main",
          },
        ],
      }),
    );

    render(<ResumeSessionModal {...base} />);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    // Calls the GENERIC route with provider=claude (not /claude-sessions).
    const url = String(apiFetch.mock.calls[0][0]);
    expect(url).toContain("/api/agent/sessions?");
    expect(url).toContain("provider=claude");

    expect(await screen.findByText("Resume Claude Code Session")).toBeTruthy();
    expect(await screen.findByText("fix the bug")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
  });

  it("lists a non-Claude provider (codex) by id + timestamp", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse({
        provider: "codex",
        sessions: [{ sessionId: "cx-abcdef12", lastModified: new Date().toISOString() }],
      }),
    );

    render(<ResumeSessionModal {...base} provider="codex" />);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(String(apiFetch.mock.calls[0][0])).toContain("provider=codex");
    expect(await screen.findByText("Resume OpenAI Codex Session")).toBeTruthy();
    // id stem is shown (first 8 chars), no preview paragraph.
    expect(await screen.findByText("cx-abcde")).toBeTruthy();
  });

  it("empty-states a resume-capable provider with no discoverable sessions", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ provider: "gemini", sessions: [] }));

    render(<ResumeSessionModal {...base} provider="gemini" />);

    expect(
      await screen.findByText(/No discoverable Gemini CLI sessions found/i),
    ).toBeTruthy();
  });

  it("never fetches for a non-resumable provider (antigravity)", async () => {
    render(<ResumeSessionModal {...base} provider="antigravity" />);

    expect(
      await screen.findByText(/does not support resuming a prior conversation/i),
    ).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
