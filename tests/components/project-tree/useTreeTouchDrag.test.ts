import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  readNodeAttrsFromElement,
  useTreeTouchDrag,
  type ResolvedDropTarget,
  type UseTreeTouchDragInput,
} from "@/components/session/project-tree/useTreeTouchDrag";
import type {
  DragState,
  DropIndicator,
} from "@/components/session/project-tree/useTreeDragDrop";

function makeTouchEvent(
  clientX: number,
  clientY: number,
  currentTarget: HTMLElement,
): React.TouchEvent<HTMLElement> {
  return {
    touches: [{ clientX, clientY }],
    currentTarget,
    target: currentTarget,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as React.TouchEvent<HTMLElement>;
}

function setup(overrides: Partial<UseTreeTouchDragInput> = {}) {
  const startDrag = overrides.startDrag ?? vi.fn();
  const dragOver = overrides.dragOver ?? vi.fn();
  const drop = overrides.drop ?? vi.fn(() => null);
  const cancel = overrides.cancel ?? vi.fn();
  const onDropResolved = overrides.onDropResolved ?? vi.fn();
  const haptic = overrides.haptic ?? vi.fn();
  const resolveDropTarget = overrides.resolveDropTarget ?? vi.fn(() => null);

  const input: UseTreeTouchDragInput = {
    enabled: overrides.enabled ?? true,
    startDrag,
    dragOver,
    drop,
    cancel,
    onDropResolved,
    haptic,
    resolveDropTarget,
    longPressMs: overrides.longPressMs,
    moveThresholdPx: overrides.moveThresholdPx,
  };

  const rendered = renderHook(() => useTreeTouchDrag(input));
  return {
    ...rendered,
    startDrag,
    dragOver,
    drop,
    cancel,
    onDropResolved,
    haptic,
    resolveDropTarget,
  };
}

describe("useTreeTouchDrag", () => {
  let element: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement("div");
    element.style.width = "200px";
    element.style.height = "40px";
    document.body.appendChild(element);
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clean up any leftover clones appended to body
    document.body.innerHTML = "";
  });

  it("is disabled when enabled=false: touchStart does not schedule long-press", () => {
    const ctx = setup({ enabled: false });
    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "group",
        "g1",
        null,
      );
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(ctx.startDrag).not.toHaveBeenCalled();
    expect(ctx.haptic).not.toHaveBeenCalled();
  });

  it("fires long-press after default 400ms and calls startDrag + haptic", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "group",
        "g1",
        null,
      );
    });
    act(() => {
      vi.advanceTimersByTime(410);
    });
    expect(ctx.startDrag).toHaveBeenCalledWith("group", "g1", null);
    expect(ctx.startDrag).toHaveBeenCalledTimes(1);
    expect(ctx.haptic).toHaveBeenCalledWith(50);
  });

  it("respects custom longPressMs", () => {
    const ctx = setup({ longPressMs: 200 });
    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "project",
        "p1",
        "g1",
      );
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(ctx.startDrag).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(ctx.startDrag).toHaveBeenCalledWith("project", "p1", "g1");
  });

  it("cancels long-press when move exceeds threshold", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "group",
        "g1",
        null,
      );
    });
    // Move dx=15 > default threshold of 10
    act(() => {
      ctx.result.current.handleTouchMove(makeTouchEvent(25, 20, element));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(ctx.startDrag).not.toHaveBeenCalled();
  });

  it("does NOT cancel long-press for moves within threshold", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "group",
        "g1",
        null,
      );
    });
    // dx=5, dy=5, both under the default 10px threshold.
    act(() => {
      ctx.result.current.handleTouchMove(makeTouchEvent(15, 25, element));
    });
    act(() => {
      vi.advanceTimersByTime(410);
    });
    expect(ctx.startDrag).toHaveBeenCalledTimes(1);
  });

  it("calls dragOver on touchMove after drag has started", () => {
    const target: ResolvedDropTarget = {
      nodeType: "group",
      nodeId: "g2",
      rect: { top: 50, height: 40 },
      parentId: null,
    };
    const resolveDropTarget = vi.fn(() => target);
    const ctx = setup({ resolveDropTarget });

    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "group",
        "g1",
        null,
      );
    });
    act(() => {
      vi.advanceTimersByTime(410);
    });
    expect(ctx.startDrag).toHaveBeenCalled();

    act(() => {
      ctx.result.current.handleTouchMove(makeTouchEvent(100, 80, element));
    });
    expect(resolveDropTarget).toHaveBeenCalledWith(100, 80);
    expect(ctx.dragOver).toHaveBeenCalledWith(
      "group",
      "g2",
      80,
      { top: 50, height: 40 },
      { targetParentId: null },
    );
  });

  it("calls drop(lastTargetType, lastTargetId) on touchEnd when drag is active and target resolved", () => {
    const target: ResolvedDropTarget = {
      nodeType: "project",
      nodeId: "p2",
      rect: { top: 50, height: 40 },
      parentId: "g1",
    };
    const dragState: DragState = {
      type: "project",
      id: "p1",
      sourceParentId: "g1",
    };
    const indicator: DropIndicator = {
      position: "nest",
      targetId: "p2",
      targetType: "project",
    };
    const snap = { drag: dragState, indicator };
    const drop = vi.fn(() => snap);
    const onDropResolved = vi.fn();
    const resolveDropTarget = vi.fn(() => target);

    const ctx = setup({ drop, onDropResolved, resolveDropTarget });

    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "project",
        "p1",
        "g1",
      );
    });
    act(() => {
      vi.advanceTimersByTime(410);
    });
    act(() => {
      ctx.result.current.handleTouchMove(makeTouchEvent(100, 80, element));
    });
    act(() => {
      ctx.result.current.handleTouchEnd(makeTouchEvent(100, 80, element));
    });

    expect(drop).toHaveBeenCalledWith("project", "p2");
    expect(onDropResolved).toHaveBeenCalledWith(snap);
  });

  it("touchEnd without a resolved target calls cancel and does not call drop", () => {
    const drop = vi.fn(() => null);
    const cancel = vi.fn();
    const ctx = setup({ drop, cancel });

    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "group",
        "g1",
        null,
      );
    });
    act(() => {
      vi.advanceTimersByTime(410);
    });
    // No touchMove — no target resolved.
    act(() => {
      ctx.result.current.handleTouchEnd(makeTouchEvent(10, 20, element));
    });
    expect(drop).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it("touchEnd before long-press fires does nothing (no drop, no cancel)", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "group",
        "g1",
        null,
      );
    });
    // Tap — end before the long-press fires.
    act(() => {
      ctx.result.current.handleTouchEnd(makeTouchEvent(10, 20, element));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(ctx.startDrag).not.toHaveBeenCalled();
    expect(ctx.drop).not.toHaveBeenCalled();
  });

  it("creates and removes a visual clone around the long-press → touchEnd lifecycle", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "group",
        "g1",
        null,
      );
    });
    const clonesBefore = document.body.querySelectorAll("[data-rdv-touch-clone]").length;
    expect(clonesBefore).toBe(0);

    act(() => {
      vi.advanceTimersByTime(410);
    });
    const clonesDuring = document.body.querySelectorAll("[data-rdv-touch-clone]").length;
    expect(clonesDuring).toBe(1);
    // Original should be dimmed.
    expect(element.style.opacity).toBe("0.5");

    act(() => {
      ctx.result.current.handleTouchEnd(makeTouchEvent(10, 20, element));
    });
    const clonesAfter = document.body.querySelectorAll("[data-rdv-touch-clone]").length;
    expect(clonesAfter).toBe(0);
    // Original restored.
    expect(element.style.opacity).toBe("");
  });

  it("does not crash / call dragOver on touchMove when not yet dragging and under threshold", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(
        makeTouchEvent(10, 20, element),
        "group",
        "g1",
        null,
      );
    });
    act(() => {
      ctx.result.current.handleTouchMove(makeTouchEvent(12, 22, element));
    });
    expect(ctx.dragOver).not.toHaveBeenCalled();
    expect(ctx.resolveDropTarget).not.toHaveBeenCalled();
  });
});

describe("readNodeAttrsFromElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("normalizes empty-string data-node-parent-id to null for root-level rows", () => {
    // Root-level groups render with data-node-parent-id="" (see GroupRow /
    // ProjectRow). The raw dataset value round-trips as "" rather than
    // undefined, so the resolver has to normalize explicitly or equality with
    // `drag.sourceParentId: null` silently fails.
    const gA = document.createElement("div");
    gA.setAttribute("data-node-id", "gA");
    gA.setAttribute("data-node-type", "group");
    gA.setAttribute("data-node-parent-id", "");
    document.body.appendChild(gA);

    const gB = document.createElement("div");
    gB.setAttribute("data-node-id", "gB");
    gB.setAttribute("data-node-type", "group");
    gB.setAttribute("data-node-parent-id", "");
    document.body.appendChild(gB);

    const resolvedA = readNodeAttrsFromElement(gA);
    const resolvedB = readNodeAttrsFromElement(gB);

    expect(resolvedA).not.toBeNull();
    expect(resolvedA!.nodeId).toBe("gA");
    expect(resolvedA!.nodeType).toBe("group");
    expect(resolvedA!.parentId).toBeNull();

    expect(resolvedB).not.toBeNull();
    expect(resolvedB!.parentId).toBeNull();
  });

  it("preserves a non-empty data-node-parent-id", () => {
    const child = document.createElement("div");
    child.setAttribute("data-node-id", "p1");
    child.setAttribute("data-node-type", "project");
    child.setAttribute("data-node-parent-id", "g1");
    document.body.appendChild(child);
    const resolved = readNodeAttrsFromElement(child);
    expect(resolved?.parentId).toBe("g1");
  });

  it("returns null when element has no data-node-id ancestor", () => {
    const bare = document.createElement("div");
    document.body.appendChild(bare);
    expect(readNodeAttrsFromElement(bare)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(readNodeAttrsFromElement(null)).toBeNull();
  });
});
