import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  TrashButtonContextMenu,
  TrashButtonContextMenuContent,
} from "@/components/session/TrashButtonContextMenu";

describe("TrashButtonContextMenuContent", () => {
  it("renders the Empty Permanently item", () => {
    render(<TrashButtonContextMenuContent onEmptyPermanently={() => {}} />);
    expect(screen.getByText("Empty Permanently")).toBeInTheDocument();
  });

  it("fires onEmptyPermanently when clicked", () => {
    const onEmptyPermanently = vi.fn();
    render(
      <TrashButtonContextMenuContent
        onEmptyPermanently={onEmptyPermanently}
      />,
    );
    fireEvent.click(screen.getByText("Empty Permanently"));
    expect(onEmptyPermanently).toHaveBeenCalledOnce();
  });
});

describe("TrashButtonContextMenu wrapper + empty-trash flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders its trigger child", () => {
    render(
      <TrashButtonContextMenu onEmptyPermanently={() => {}}>
        <button>Trash</button>
      </TrashButtonContextMenu>,
    );
    expect(screen.getByText("Trash")).toBeInTheDocument();
  });

  it("does NOT fire the fetch when the user cancels confirm (mirrors Sidebar handler)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => false));
    // Simulate the Sidebar's handleEmptyTrashPermanently logic
    const handler = () => {
      if (!window.confirm("msg")) return;
      void fetch("/api/trash", { method: "POST" });
    };
    render(
      <TrashButtonContextMenuContent onEmptyPermanently={handler} />,
    );
    fireEvent.click(screen.getByText("Empty Permanently"));
    expect(window.confirm).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fires fetch(/api/trash, POST) when the user confirms", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const handler = () => {
      if (!window.confirm("msg")) return;
      void fetch("/api/trash", { method: "POST" });
    };
    render(
      <TrashButtonContextMenuContent onEmptyPermanently={handler} />,
    );
    fireEvent.click(screen.getByText("Empty Permanently"));
    expect(fetchMock).toHaveBeenCalledWith("/api/trash", { method: "POST" });
  });
});
