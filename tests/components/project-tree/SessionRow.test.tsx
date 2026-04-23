import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionRow } from "@/components/session/project-tree/SessionRow";
// Global vi.mock of @/hooks/useSessionGitStatus and @/contexts/PortContext
// lives in tests/setup.ts — override via mockReturnValueOnce below.
import { useSessionGitStatus } from "@/hooks/useSessionGitStatus";
import { usePortContext } from "@/contexts/PortContext";

const mockedUseSessionGitStatus = vi.mocked(useSessionGitStatus);
const mockedUsePortContext = vi.mocked(usePortContext);

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

const shellSession = {
  id: "s1",
  name: "web-server",
  projectId: "p1",
  pinned: false,
  terminalType: "shell",
} as unknown as Parameters<typeof SessionRow>[0]["session"];

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

  it("has aria-label matching session name", () => {
    render(<SessionRow {...baseProps} session={shellSession} />);
    expect(screen.getByRole("button", { name: shellSession.name })).toBeInTheDocument();
  });

  it("calls onClick and calls preventDefault when Enter is pressed", () => {
    const onClick = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} onClick={onClick} />);
    const row = screen.getByRole("button", { name: shellSession.name });
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    row.dispatchEvent(event);
    expect(onClick).toHaveBeenCalledOnce();
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it("calls onClick and calls preventDefault when Space is pressed", () => {
    const onClick = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} onClick={onClick} />);
    const row = screen.getByRole("button", { name: shellSession.name });
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    row.dispatchEvent(event);
    expect(onClick).toHaveBeenCalledOnce();
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  // Inline rename tests
  it("renders an input in place of the name when isEditing", () => {
    render(<SessionRow {...baseProps} session={shellSession} isEditing />);
    expect(screen.getByRole("textbox")).toHaveValue(shellSession.name);
  });

  it("prefers editValue over session.name when provided", () => {
    render(<SessionRow {...baseProps} session={shellSession} isEditing editValue="custom" />);
    expect(screen.getByRole("textbox")).toHaveValue("custom");
  });

  it("calls onSaveEdit(trimmed) on Enter with a new value", () => {
    const onSaveEdit = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} isEditing onSaveEdit={onSaveEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Renamed  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSaveEdit).toHaveBeenCalledWith("Renamed");
  });

  it("calls onCancelEdit (not onSaveEdit) on Enter when value is unchanged", () => {
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} isEditing onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).toHaveBeenCalledOnce();
  });

  it("calls onCancelEdit on Escape without submitting", () => {
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} isEditing onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "typed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).toHaveBeenCalledOnce();
  });

  it("fires onStartEdit on double-click of the name", () => {
    const onStartEdit = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} onStartEdit={onStartEdit} />);
    fireEvent.doubleClick(screen.getByText(shellSession.name));
    expect(onStartEdit).toHaveBeenCalled();
  });

  it("does not double-submit when Enter then blur fire", () => {
    const onSaveEdit = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} isEditing onSaveEdit={onSaveEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
  });

  it("commits on blur with a new value", () => {
    const onSaveEdit = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} isEditing onSaveEdit={onSaveEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Blurred" } });
    fireEvent.blur(input);
    expect(onSaveEdit).toHaveBeenCalledWith("Blurred");
  });

  // Session metadata bar integration (remote-dev-yy0t)
  describe("SessionMetadataBar integration", () => {
    it("renders the metadata bar when gitStatus has a branch", () => {
      mockedUseSessionGitStatus.mockReturnValueOnce({
        gitStatus: { branch: "feat/xyz", ahead: 1, behind: 0, pr: null },
        loading: false,
        refresh: vi.fn(),
      });
      mockedUsePortContext.mockReturnValueOnce({ allocations: [] } as never);
      const { container } = render(<SessionRow {...baseProps} session={shellSession} />);
      expect(screen.getByText("feat/xyz")).toBeInTheDocument();
      expect(container.querySelector("svg.lucide-git-branch")).toBeTruthy();
    });

    it("renders port chips from usePortContext allocations for this project", () => {
      mockedUseSessionGitStatus.mockReturnValueOnce({
        gitStatus: null,
        loading: false,
        refresh: vi.fn(),
      });
      mockedUsePortContext.mockReturnValueOnce({
        allocations: [
          { port: 3000, folderId: "p1" },
          { port: 5173, folderId: "p2" },
        ],
      } as never);
      render(<SessionRow {...baseProps} session={shellSession} />);
      expect(screen.getByText(":3000")).toBeInTheDocument();
      expect(screen.queryByText(":5173")).toBeNull();
    });

    it("does not render the metadata bar when there is no git status and no ports", () => {
      mockedUseSessionGitStatus.mockReturnValueOnce({
        gitStatus: null,
        loading: false,
        refresh: vi.fn(),
      });
      mockedUsePortContext.mockReturnValueOnce({ allocations: [] } as never);
      const { container } = render(<SessionRow {...baseProps} session={shellSession} />);
      // No GitBranch icon and no port pill
      expect(container.querySelector("svg.lucide-git-branch")).toBeNull();
      expect(container.querySelector("svg.lucide-radio")).toBeNull();
    });
  });
});
