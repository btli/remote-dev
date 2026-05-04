/**
 * useProfileNavStack tests — Phase 6 mobile redesign.
 *
 * Verifies the push/pop/reset semantics of the Profile-tab navigation
 * stack in isolation. The hook is a primitive — these tests should be
 * boring and exhaustive.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useProfileNavStack } from "@/components/mobile/profile/useProfileNavStack";

afterEach(() => cleanup());

type Screen = "a" | "b" | "c";

/**
 * Build a popstate event whose `state.profileNav.depth` matches the
 * intended target stack depth. This mirrors what the hook itself
 * embeds via pushState, and what the browser supplies on a real back.
 */
function popstateWithDepth(depth: number, screen = "test"): PopStateEvent {
  const state = depth > 0 ? { profileNav: { depth, screen } } : null;
  return new PopStateEvent("popstate", { state });
}

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

    // Simulate hardware back / browser back: the browser supplies the
    // state of the entry we're popping TO (the previous one, depth=1).
    act(() => {
      window.dispatchEvent(popstateWithDepth(1));
    });
    expect(result.current.current).toBe("a");

    // Another back: now we're leaving the profile area entirely. The
    // entry we land on has no profileNav state.
    act(() => {
      window.dispatchEvent(popstateWithDepth(0));
    });
    expect(result.current.isPushed).toBe(false);
    expect(result.current.current).toBeNull();
  });

  it("ignores popstate when already on the index", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => {
      window.dispatchEvent(popstateWithDepth(0));
    });
    expect(result.current.isPushed).toBe(false);
    expect(result.current.stack).toEqual([]);
  });

  // P2-D: popstate reconciles from event.state rather than blindly slicing.
  it("reconciles to a shallower depth from popstate state.profileNav.depth", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.push("a"));
    act(() => result.current.push("b"));
    act(() => result.current.push("c"));
    expect(result.current.stack).toEqual(["a", "b", "c"]);

    // Simulate a popstate that lands on depth 1 (e.g. user pressed back
    // twice rapidly and the second event arrived before the first
    // settled). We should pop to depth 1, not depth 2.
    act(() => {
      window.dispatchEvent(popstateWithDepth(1));
    });
    expect(result.current.stack).toEqual(["a"]);
  });

  it("treats missing profileNav state as 'leaving the profile area' and pops all", () => {
    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.push("a"));
    act(() => result.current.push("b"));
    expect(result.current.isPushed).toBe(true);

    // Popstate with no profileNav state means another history actor
    // (or a back beyond our owned entries). We should pop the whole
    // stack rather than blindly slicing one entry.
    act(() => {
      window.dispatchEvent(popstateWithDepth(0));
    });
    expect(result.current.isPushed).toBe(false);
    expect(result.current.stack).toEqual([]);
  });

  // P2-E: double-tap on the back chevron should not double-pop.
  it("guards against rapid double pop() calls", () => {
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {
      // Don't actually navigate; just record the call.
    });

    const { result } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.push("a"));
    act(() => result.current.push("b"));

    // Two pop calls in quick succession (no popstate fired between them)
    // should result in only ONE history.back() invocation.
    act(() => {
      result.current.pop();
      result.current.pop();
    });
    expect(backSpy).toHaveBeenCalledTimes(1);

    // After a popstate fires, the guard clears and another pop is
    // allowed to issue history.back().
    act(() => {
      window.dispatchEvent(popstateWithDepth(1));
    });
    act(() => {
      result.current.pop();
    });
    expect(backSpy).toHaveBeenCalledTimes(2);

    backSpy.mockRestore();
  });

  // P1-C: history entries are rolled back when the host unmounts mid-stack.
  it("rolls back owned history entries on unmount when the stack is pushed", () => {
    const goSpy = vi.spyOn(window.history, "go").mockImplementation(() => {
      // Don't actually navigate; just record.
    });

    const { result, unmount } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.push("a"));
    act(() => result.current.push("b"));

    unmount();

    // Two pushed entries → expect history.go(-2) on unmount.
    expect(goSpy).toHaveBeenCalledWith(-2);

    goSpy.mockRestore();
  });

  it("does not roll back history on unmount when the stack is empty", () => {
    const goSpy = vi.spyOn(window.history, "go").mockImplementation(() => {
      // Don't actually navigate.
    });

    const { unmount } = renderHook(() => useProfileNavStack<Screen>());
    unmount();

    expect(goSpy).not.toHaveBeenCalled();

    goSpy.mockRestore();
  });

  it("does not double-roll history when reset() preceded unmount", () => {
    const goSpy = vi.spyOn(window.history, "go").mockImplementation(() => {
      // Don't actually navigate.
    });

    const { result, unmount } = renderHook(() => useProfileNavStack<Screen>());
    act(() => result.current.push("a"));
    act(() => result.current.push("b"));
    act(() => result.current.reset());

    expect(goSpy).toHaveBeenCalledWith(-2);
    goSpy.mockClear();

    unmount();

    // Reset already drained the entries; unmount must not re-drain.
    expect(goSpy).not.toHaveBeenCalled();
    goSpy.mockRestore();
  });
});
