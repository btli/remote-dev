import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionRow } from "@/components/session/project-tree/SessionRow";

const baseProps = {
  depth: 1,
  isActive: false,
  isEditing: false,
  hasUnread: false,
  agentStatus: null as null,
  scheduleCount: 0,
  onClick: vi.fn(),
  onClose: vi.fn(),
  onStartEdit: vi.fn(),
};

const shellSession: any = {
  id: "s1",
  name: "web-server",
  projectId: "p1",
  pinned: false,
  terminalType: "shell",
};

describe("SessionRow", () => {
  it("renders the session name", () => {
    render(<SessionRow {...baseProps} session={shellSession} />);
    expect(screen.getByText("web-server")).toBeInTheDocument();
  });

  it("shows the pin indicator when session is pinned", () => {
    const pinned = { ...shellSession, pinned: true };
    const { container } = render(<SessionRow {...baseProps} session={pinned} />);
    expect(container.querySelector('[data-lucide="pin"], svg')).toBeTruthy();
  });

  it("shows the unread dot when hasUnread", () => {
    const { container } = render(<SessionRow {...baseProps} session={shellSession} hasUnread />);
    expect(container.querySelector(".animate-pulse.bg-blue-400")).toBeTruthy();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close session/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClick when row is clicked", () => {
    const onClick = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} onClick={onClick} />);
    fireEvent.click(screen.getByText("web-server"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("calls onStartEdit on double-click", () => {
    const onStartEdit = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} onStartEdit={onStartEdit} />);
    fireEvent.doubleClick(screen.getByText("web-server"));
    expect(onStartEdit).toHaveBeenCalledOnce();
  });

  it("applies agent breathing color when agentStatus=running", () => {
    const agent = { ...shellSession, terminalType: "agent" };
    const { container } = render(
      <SessionRow {...baseProps} session={agent} agentStatus="running" />
    );
    expect(container.querySelector(".agent-breathing.text-green-500")).toBeTruthy();
  });

  it("shows schedule count when > 0", () => {
    render(<SessionRow {...baseProps} session={shellSession} scheduleCount={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
