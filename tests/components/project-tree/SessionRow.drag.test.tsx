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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors existing test fixture shape in SessionRow.test.tsx
const shellSession: any = {
  id: "s1",
  name: "web-server",
  projectId: "p1",
  pinned: false,
  terminalType: "shell",
};

describe("SessionRow drag passthrough", () => {
  it("invokes onDragStart when draggable and drag starts", () => {
    const onDragStart = vi.fn();
    render(
      <SessionRow
        {...baseProps}
        session={shellSession}
        draggable
        onDragStart={onDragStart}
      />,
    );
    const row = screen.getByRole("button", { name: shellSession.name });
    expect(row.getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(row);
    expect(onDragStart).toHaveBeenCalledOnce();
  });

  it("invokes onDragOver, onDragLeave, onDrop when supplied", () => {
    const onDragOver = vi.fn();
    const onDragLeave = vi.fn();
    const onDrop = vi.fn();
    render(
      <SessionRow
        {...baseProps}
        session={shellSession}
        draggable
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />,
    );
    const row = screen.getByRole("button", { name: shellSession.name });
    fireEvent.dragOver(row);
    fireEvent.dragLeave(row);
    fireEvent.drop(row);
    expect(onDragOver).toHaveBeenCalledOnce();
    expect(onDragLeave).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledOnce();
  });

  it("renders non-draggable (draggable attr false) when drag props omitted", () => {
    render(<SessionRow {...baseProps} session={shellSession} />);
    const row = screen.getByRole("button", { name: shellSession.name });
    // draggable defaults to false (string "false" after serialization)
    expect(row.getAttribute("draggable")).toBe("false");
  });
});
