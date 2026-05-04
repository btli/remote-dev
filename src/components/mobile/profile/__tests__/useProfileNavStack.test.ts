/**
 * useProfileNavStack tests — Phase 6 mobile redesign.
 *
 * Verifies the push/pop/reset semantics of the Profile-tab navigation
 * stack in isolation. The hook is a primitive — these tests should be
 * boring and exhaustive.
 */

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useProfileNavStack } from "@/components/mobile/profile/useProfileNavStack";

afterEach(() => cleanup());

type Screen = "a" | "b" | "c";

describe("useProfileNavStack", () => {
  it("starts at the index", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    expect(result.current.stack).toEqual([]);
    expect(result.current.current).toBeNull();
    expect(result.current.isPushed).toBe(false);
  });

  it("push adds a screen and reports it as current", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.push("a"));
    expect(result.current.stack).toEqual(["a"]);
    expect(result.current.current).toBe("a");
    expect(result.current.isPushed).toBe(true);
  });

  it("supports stacking multiple screens", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.push("a"));
    act(() => result.current.push("b"));
    act(() => result.current.push("c"));
    expect(result.current.stack).toEqual(["a", "b", "c"]);
    expect(result.current.current).toBe("c");
  });

  it("pop removes the top screen", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.push("a"));
    act(() => result.current.push("b"));
    act(() => result.current.pop());
    expect(result.current.stack).toEqual(["a"]);
    expect(result.current.current).toBe("a");
  });

  it("pop on the index is a no-op", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.pop());
    expect(result.current.stack).toEqual([]);
    expect(result.current.current).toBeNull();
  });

  it("reset bounces all the way back to the index", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.push("a"));
    act(() => result.current.push("b"));
    act(() => result.current.reset());
    expect(result.current.stack).toEqual([]);
    expect(result.current.current).toBeNull();
    expect(result.current.isPushed).toBe(false);
  });

  it("pops the stack when a popstate event fires (Android/browser back)", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.push("a"));
    act(() => result.current.push("b"));
    expect(result.current.isPushed).toBe(true);
    expect(result.current.current).toBe("b");

    // Simulate hardware back / browser back: dispatch popstate directly
    // so we exercise the listener regardless of how the test environment
    // implements history.back().
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(result.current.current).toBe("a");

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(result.current.isPushed).toBe(false);
    expect(result.current.current).toBeNull();
  });

  it("ignores popstate when already on the index", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(result.current.isPushed).toBe(false);
    expect(result.current.stack).toEqual([]);
  });
});
