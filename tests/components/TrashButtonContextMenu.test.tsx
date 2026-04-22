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
      void fetch("/api/trash", { method: "DELETE" });
    };
    render(
      <TrashButtonContextMenuContent onEmptyPermanently={handler} />,
    );
    fireEvent.click(screen.getByText("Empty Permanently"));
    expect(window.confirm).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fires fetch(/api/trash, DELETE) when the user confirms", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const handler = () => {
      if (!window.confirm("msg")) return;
      void fetch("/api/trash", { method: "DELETE" });
    };
    render(
      <TrashButtonContextMenuContent onEmptyPermanently={handler} />,
    );
    fireEvent.click(screen.getByText("Empty Permanently"));
    // Must call DELETE — not POST, which only purges expired items.
    // See remote-dev-nmw4.
    expect(fetchMock).toHaveBeenCalledWith("/api/trash", { method: "DELETE" });
  });

  it("surfaces an error alert when the DELETE request fails (mirrors Sidebar handler)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
      ),
    );
    const alertMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("alert", alertMock);

    // Mirror Sidebar.handleEmptyTrashPermanently's error path.
    const handler = async () => {
      if (!window.confirm("msg")) return;
      const res = await fetch("/api/trash", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = body?.error ? `: ${String(body.error)}` : "";
        window.alert(`Failed to empty trash${detail}`);
      }
    };

    render(<TrashButtonContextMenuContent onEmptyPermanently={handler} />);
    fireEvent.click(screen.getByText("Empty Permanently"));
    // Let the microtasks from the await resolve.
    await new Promise((r) => setTimeout(r, 0));
    expect(alertMock).toHaveBeenCalledWith("Failed to empty trash: boom");
  });
});
