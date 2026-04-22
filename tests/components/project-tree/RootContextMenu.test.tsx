import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  RootContextMenu,
  RootContextMenuContent,
} from "@/components/session/project-tree/RootContextMenu";

function setupContent(
  override: Partial<React.ComponentProps<typeof RootContextMenuContent>> = {},
) {
  const handlers = {
    onNewGroup: vi.fn(),
    onNewProject: vi.fn(),
  };
  const utils = render(<RootContextMenuContent {...handlers} {...override} />);
  return { ...utils, handlers };
}

describe("RootContextMenuContent", () => {
  it("renders New Group and New Project items", () => {
    setupContent();
    expect(screen.getByText("New Group")).toBeInTheDocument();
    expect(screen.getByText("New Project")).toBeInTheDocument();
  });

  it("fires onNewGroup when New Group is clicked", () => {
    const { handlers } = setupContent();
    fireEvent.click(screen.getByText("New Group"));
    expect(handlers.onNewGroup).toHaveBeenCalledOnce();
  });

  it("fires onNewProject when New Project is clicked", () => {
    const { handlers } = setupContent();
    fireEvent.click(screen.getByText("New Project"));
    expect(handlers.onNewProject).toHaveBeenCalledOnce();
  });
});

describe("RootContextMenu (wrapper)", () => {
  it("renders its trigger child", () => {
    render(
      <RootContextMenu onNewGroup={() => {}} onNewProject={() => {}}>
        <div>tree-area</div>
      </RootContextMenu>,
    );
    expect(screen.getByText("tree-area")).toBeInTheDocument();
  });
});
