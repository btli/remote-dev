import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type React from "react";
import {
  useSwipeToClose,
  type UseSwipeToCloseInput,
} from "@/components/session/project-tree/useSwipeToClose";

function touchEvent(
  clientX: number,
  clientY: number,
): React.TouchEvent<HTMLElement> {
  return {
    touches: [{ clientX, clientY }],
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as React.TouchEvent<HTMLElement>;
}

function setup(overrides: Partial<UseSwipeToCloseInput> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const canSwipe = overrides.canSwipe;
  const input: UseSwipeToCloseInput = {
    enabled: overrides.enabled ?? true,
    onClose,
    canSwipe,
    commitThresholdPx: overrides.commitThresholdPx,
    maxDragPx: overrides.maxDragPx,
    axisDecisionPx: overrides.axisDecisionPx,
  };
  const rendered = renderHook(() => useSwipeToClose(input));
  return { ...rendered, onClose };
}

describe("useSwipeToClose", () => {
  it("is a no-op when disabled=false", () => {
    const ctx = setup({ enabled: false });
    act(() => {
      ctx.result.current.handleTouchStart(touchEvent(100, 200), "s1");
    });
    act(() => {
      ctx.result.current.handleTouchMove(touchEvent(50, 200));
    });
    act(() => {
      ctx.result.current.handleTouchEnd();
    });
    expect(ctx.result.current.swipedSessionId).toBeNull();
    const style = ctx.result.current.getRowStyle("s1");
    expect(String(style.transform)).not.toContain("-");
  });

  it("does not engage when canSwipe returns false", () => {
    const canSwipe = vi.fn(() => false);
    const ctx = setup({ canSwipe });
    act(() => {
      ctx.result.current.handleTouchStart(touchEvent(100, 200), "s1");
    });
    act(() => {
      ctx.result.current.handleTouchMove(touchEvent(50, 200));
    });
    act(() => {
      ctx.result.current.handleTouchEnd();
    });
    expect(canSwipe).toHaveBeenCalledWith("s1");
    expect(ctx.result.current.swipedSessionId).toBeNull();
    const style = ctx.result.current.getRowStyle("s1");
    expect(style.transform).toBe("translateX(0)");
  });

  it("horizontal swipe past threshold commits and sets swipedSessionId", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(touchEvent(100, 200), "s1");
    });
    act(() => {
      ctx.result.current.handleTouchMove(touchEvent(50, 200)); // dx=-50, dy=0
    });
    act(() => {
      ctx.result.current.handleTouchEnd();
    });
    expect(ctx.result.current.swipedSessionId).toBe("s1");
  });

  it("horizontal swipe below threshold does not commit", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(touchEvent(100, 200), "s1");
    });
    act(() => {
      ctx.result.current.handleTouchMove(touchEvent(80, 200)); // dx=-20
    });
    act(() => {
      ctx.result.current.handleTouchEnd();
    });
    expect(ctx.result.current.swipedSessionId).toBeNull();
  });

  it("vertical drag aborts swipe — row is not translated and no commit", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(touchEvent(100, 200), "s1");
    });
    act(() => {
      // dx=-5 small, dy=-50 large → axis decides vertical, abort
      ctx.result.current.handleTouchMove(touchEvent(95, 150));
    });
    const style = ctx.result.current.getRowStyle("s1");
    expect(style.transform).toBe("translateX(0)");
    act(() => {
      ctx.result.current.handleTouchEnd();
    });
    expect(ctx.result.current.swipedSessionId).toBeNull();
  });

  it("right-swipe (dx > 0) is clamped to 0 (row stays at rest)", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(touchEvent(100, 200), "s1");
    });
    act(() => {
      // dx=30, dy=0: horizontal axis, but rightward → clamp to 0
      ctx.result.current.handleTouchMove(touchEvent(130, 200));
    });
    const style = ctx.result.current.getRowStyle("s1");
    // currentDx === 0 is the idle case in getRowStyle (not "< 0"), so we get
    // the resting transform.
    expect(style.transform).toBe("translateX(0)");
    act(() => {
      ctx.result.current.handleTouchEnd();
    });
    expect(ctx.result.current.swipedSessionId).toBeNull();
  });

  it("clamps extreme leftward drag to -maxDragPx (default 80)", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(touchEvent(100, 200), "s1");
    });
    act(() => {
      // dx=-120 → clamp to -80
      ctx.result.current.handleTouchMove(touchEvent(-20, 200));
    });
    const style = ctx.result.current.getRowStyle("s1");
    expect(style.transform).toBe("translateX(-80px)");
  });

  it("clearSwipe resets committed state", () => {
    const ctx = setup();
    act(() => {
      ctx.result.current.handleTouchStart(touchEvent(100, 200), "s1");
    });
    act(() => {
      ctx.result.current.handleTouchMove(touchEvent(50, 200));
    });
    act(() => {
      ctx.result.current.handleTouchEnd();
    });
    expect(ctx.result.current.swipedSessionId).toBe("s1");
    act(() => {
      ctx.result.current.clearSwipe();
    });
    expect(ctx.result.current.swipedSessionId).toBeNull();
  });

  it("getRowStyle: transition none during active horizontal drag; 200ms ease-out when idle", () => {
    const ctx = setup();
    // Idle
    let style = ctx.result.current.getRowStyle("s1");
    expect(style.transition).toBe("transform 200ms ease-out");

    // Active drag on s1
    act(() => {
      ctx.result.current.handleTouchStart(touchEvent(100, 200), "s1");
    });
    act(() => {
      ctx.result.current.handleTouchMove(touchEvent(70, 200)); // dx=-30
    });
    style = ctx.result.current.getRowStyle("s1");
    expect(style.transition).toBe("none");

    // Another sessionId unaffected
    const other = ctx.result.current.getRowStyle("s2");
    expect(other.transition).toBe("transform 200ms ease-out");
  });
});
