/**
 * Unit tests for usePinchZoom (Phase 3 mobile session view).
 *
 * Covers the post-final-review refactor: the hook now attaches native
 * (non-passive) touch listeners to the bound element via a ref callback,
 * so it can preventDefault() multi-touch gestures on iOS Safari.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { usePinchZoom } from "@/components/mobile/session/usePinchZoom";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeTouch(id: number, clientX: number, clientY: number): Touch {
  return new Touch({
    identifier: id,
    target: document as unknown as EventTarget,
    clientX,
    clientY,
  });
}

describe("usePinchZoom", () => {
  it("registers touchstart and touchmove with passive: false on the bound element", () => {
    const el = document.createElement("div");
    const addSpy = vi.spyOn(el, "addEventListener");
    const { result } = renderHook(() => usePinchZoom());

    act(() => {
      result.current.ref(el);
    });

    const startCall = addSpy.mock.calls.find(
      ([type]) => type === "touchstart"
    );
    const moveCall = addSpy.mock.calls.find(
      ([type]) => type === "touchmove"
    );
    expect(startCall).toBeDefined();
    expect(moveCall).toBeDefined();
    // Third arg should be { passive: false } to allow preventDefault.
    expect(startCall?.[2]).toMatchObject({ passive: false });
    expect(moveCall?.[2]).toMatchObject({ passive: false });
  });

  it("calls onScale during a two-finger pinch and onScaleCommit on touchend", () => {
    const el = document.createElement("div");
    const onScale = vi.fn();
    const onScaleCommit = vi.fn();
    const { result } = renderHook(() =>
      usePinchZoom({ onScale, onScaleCommit, thresholdPx: 0 })
    );

    act(() => {
      result.current.ref(el);
    });

    // Start with fingers 100px apart.
    const t1Start = makeTouch(1, 0, 0);
    const t2Start = makeTouch(2, 100, 0);
    el.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [t1Start, t2Start],
        targetTouches: [t1Start, t2Start],
        changedTouches: [t1Start, t2Start],
        bubbles: true,
      })
    );

    // Move so fingers are 150px apart (factor = 1.5).
    const t1Move = makeTouch(1, 0, 0);
    const t2Move = makeTouch(2, 150, 0);
    el.dispatchEvent(
      new TouchEvent("touchmove", {
        touches: [t1Move, t2Move],
        targetTouches: [t1Move, t2Move],
        changedTouches: [t1Move, t2Move],
        bubbles: true,
      })
    );

    expect(onScale).toHaveBeenCalled();
    const lastFactor = onScale.mock.calls.at(-1)?.[0] as number;
    expect(lastFactor).toBeGreaterThan(1.4);

    el.dispatchEvent(
      new TouchEvent("touchend", {
        touches: [],
        targetTouches: [],
        changedTouches: [],
        bubbles: true,
      })
    );
    expect(onScaleCommit).toHaveBeenCalledTimes(1);
  });

  it("calls preventDefault on multi-touch touchmove so the browser doesn't pinch-zoom in parallel", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() =>
      usePinchZoom({ thresholdPx: 0 })
    );

    act(() => {
      result.current.ref(el);
    });

    const t1Start = makeTouch(1, 0, 0);
    const t2Start = makeTouch(2, 100, 0);
    el.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [t1Start, t2Start],
        targetTouches: [t1Start, t2Start],
        changedTouches: [t1Start, t2Start],
        bubbles: true,
      })
    );

    const t1Move = makeTouch(1, 0, 0);
    const t2Move = makeTouch(2, 140, 0);
    const moveEvent = new TouchEvent("touchmove", {
      touches: [t1Move, t2Move],
      targetTouches: [t1Move, t2Move],
      changedTouches: [t1Move, t2Move],
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(moveEvent, "preventDefault");
    el.dispatchEvent(moveEvent);
    expect(preventSpy).toHaveBeenCalled();
  });

  it("removes listeners when the element is detached via a null ref", () => {
    const el = document.createElement("div");
    const removeSpy = vi.spyOn(el, "removeEventListener");
    const { result } = renderHook(() => usePinchZoom());

    act(() => {
      result.current.ref(el);
    });
    act(() => {
      result.current.ref(null);
    });

    const removed = removeSpy.mock.calls.map(([type]) => type);
    expect(removed).toEqual(
      expect.arrayContaining(["touchstart", "touchmove", "touchend", "touchcancel"])
    );
  });
});
