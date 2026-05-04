/**
 * Tests for `usePullToRefresh` (Phase 2 mobile redesign).
 *
 * Verifies that:
 *   - The hook fires `onRefresh` when the user pulls past the threshold from
 *     the top of the scroll container.
 *   - The hook does NOT fire when the container is scrolled away from the top.
 *   - The hook reports `isRefreshing` while the returned promise is in-flight
 *     and resets to false after it settles.
 *   - `prefers-reduced-motion` suppresses the `pullDistance` visual.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// Mock the reduced-motion hook so individual tests can opt into the
// reduced-motion code path. Default = false so the existing happy-path
// tests below render the full visual stretch.
const reducedMotionMock = vi.fn<() => boolean>(() => false);
vi.mock("@/hooks/useMobile", () => ({
  usePrefersReducedMotion: () => reducedMotionMock(),
}));

import { usePullToRefresh } from "@/hooks/usePullToRefresh";

function fireTouch(el: HTMLElement, type: string, clientY: number) {
  const touch = { clientY, clientX: 0, identifier: 0, target: el } as unknown as Touch;
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, "touches", {
    value: [touch],
    configurable: true,
  });
  el.dispatchEvent(event);
}

describe("usePullToRefresh", () => {
  let scrollEl: HTMLDivElement;

  beforeEach(() => {
    scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    document.body.appendChild(scrollEl);
  });

  afterEach(() => {
    cleanup();
    if (scrollEl.parentNode) scrollEl.parentNode.removeChild(scrollEl);
    reducedMotionMock.mockReset();
    reducedMotionMock.mockImplementation(() => false);
  });

  it("fires onRefresh when the user pulls past the threshold from the top", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh({ onRefresh, threshold: 50 }));

    act(() => {
      result.current.ref(scrollEl);
    });

    // Simulate pull: start at 100, drag down to 300 (200px raw → 100px after
    // 50% rubber-band damping → past 50px threshold).
    act(() => {
      fireTouch(scrollEl, "touchstart", 100);
      fireTouch(scrollEl, "touchmove", 300);
    });

    expect(result.current.pullDistance).toBeGreaterThan(0);

    act(() => {
      fireTouch(scrollEl, "touchend", 300);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not fire onRefresh when scrolled past the top", () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePullToRefresh({ onRefresh, threshold: 50 }));
    Object.defineProperty(scrollEl, "scrollTop", { value: 200, writable: true });

    act(() => result.current.ref(scrollEl));
    act(() => {
      fireTouch(scrollEl, "touchstart", 100);
      fireTouch(scrollEl, "touchmove", 300);
      fireTouch(scrollEl, "touchend", 300);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("toggles isRefreshing for the duration of the refresh promise", async () => {
    let resolve!: () => void;
    const refreshPromise = new Promise<void>((r) => {
      resolve = r;
    });
    const onRefresh = vi.fn().mockReturnValue(refreshPromise);
    const { result } = renderHook(() => usePullToRefresh({ onRefresh, threshold: 50 }));

    act(() => result.current.ref(scrollEl));
    act(() => {
      fireTouch(scrollEl, "touchstart", 100);
      fireTouch(scrollEl, "touchmove", 300);
      fireTouch(scrollEl, "touchend", 300);
    });

    expect(result.current.isRefreshing).toBe(true);

    await act(async () => {
      resolve();
      await refreshPromise;
    });

    expect(result.current.isRefreshing).toBe(false);
  });

  it("still fires onRefresh past the threshold when prefers-reduced-motion is set (visual=0, raw threshold check)", () => {
    // Regression for adversarial finding P2-D: under reduced-motion the
    // visual `pullDistance` is pinned to 0. The threshold check used to
    // read the same ref, so reduced-motion users could never trigger a
    // refresh. The hook now tracks raw vs visual pull distance
    // separately — visual goes to 0, raw still drives the threshold.
    reducedMotionMock.mockImplementation(() => true);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh({ onRefresh, threshold: 50 }));

    act(() => {
      result.current.ref(scrollEl);
    });

    act(() => {
      fireTouch(scrollEl, "touchstart", 100);
      fireTouch(scrollEl, "touchmove", 300);
    });

    // Visual indicator stays at 0 — no stretch is rendered.
    expect(result.current.pullDistance).toBe(0);

    act(() => {
      fireTouch(scrollEl, "touchend", 300);
    });

    // ...but the threshold check uses the raw distance, so the refresh
    // still fires.
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
