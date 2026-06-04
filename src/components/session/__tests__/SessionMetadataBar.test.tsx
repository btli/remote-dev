import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TerminalSession } from "@/types/session";
import type { SessionMetadata } from "@/types/session-metadata";

// useSessionMetadata is the bar's data source — mock it with a rich payload.
const meta: SessionMetadata = {
  sessionId: "s1",
  git: { branch: "feat/x", ahead: 2, behind: 0, dirtyCount: 3 },
  pr: {
    number: 42,
    state: "open",
    url: "https://example/pr/42",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    ciStatus: "failing",
  },
  ports: [{ port: 3000, process: "node", pid: 111 }],
  lastActivityAt: null,
  attention: "actionable",
};

vi.mock("@/hooks/useSessionMetadata", () => ({
  useSessionMetadata: () => ({ metadata: meta, refresh: () => {} }),
  primeSessionMetadata: () => {},
}));

// PortContext supplies the proxy-URL builder for the quick-open chip.
vi.mock("@/contexts/PortContext", () => ({
  usePortContext: () => ({
    getProxyUrl: (port: number) => `/proxy/${port}/`,
  }),
}));

afterEach(cleanup);

const session = {
  id: "s1",
  name: "S",
  terminalType: "agent",
  projectId: "p1",
  agentProvider: "none",
} as unknown as TerminalSession;

describe("SessionMetadataBar", () => {
  it("renders branch, dirty count, PR number, and a session-owned port", async () => {
    const { SessionMetadataBar } = await import("../SessionMetadataBar");
    render(<SessionMetadataBar session={session} />);
    expect(screen.getByText("feat/x")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // dirty count badge
    expect(screen.getByText(/#42/)).toBeTruthy(); // PR chip
    expect(screen.getByText(/3000/)).toBeTruthy(); // port chip
  });

  it("renders an attention dot when metadata.attention is set", async () => {
    const { SessionMetadataBar } = await import("../SessionMetadataBar");
    render(<SessionMetadataBar session={session} />);
    expect(
      document.querySelector('[data-attention="actionable"]'),
    ).toBeTruthy();
  });

  it("renders nothing when collapsed", async () => {
    const { SessionMetadataBar } = await import("../SessionMetadataBar");
    const { container } = render(
      <SessionMetadataBar session={session} isCollapsed />,
    );
    expect(container.firstChild).toBeNull();
  });
});
