"use client";

/**
 * useProfileNavStack — tab-local push/pop navigation for the Profile tab.
 *
 * Phase 6 of the mobile redesign. Profile is composed of an index list
 * and a stack of pushed sub-screens. We don't reach for a router here
 * because:
 *
 *   1. The desktop URL is the canonical "session/project" navigation.
 *      Pushing profile sub-screens onto the URL would interfere with
 *      that and force a full re-render of the mobile shell.
 *   2. The stack is short-lived: the user enters Profile, taps a row,
 *      reads/edits, pops back. URL state isn't useful here.
 *
 * The stack is generic over a `Screen` string union; the host (ProfileTab)
 * supplies its own identifier set.
 *
 * Returns a tuple-like object so consumers can `push("settings")`,
 * `pop()`, or `reset()` to bounce all the way back to the index.
 *
 * Hardware/browser back: each `push` adds a `history` entry tagged with
 * `{ profileNav: <screen> }`. A `popstate` listener treats any history
 * pop while a screen is pushed as a stack pop. UI-driven `pop()` calls
 * `history.back()` so the listener is the single source of truth — that
 * way Android's hardware back button, the browser back button, and the
 * in-app back chevron all flow through one path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface NavStack<Screen extends string> {
  /** Stack of pushed screens, oldest-first. Empty array means "index". */
  stack: readonly Screen[];
  /** Top of the stack, or `null` when on the index. */
  current: Screen | null;
  /** True when the user is somewhere other than the index. */
  isPushed: boolean;
  /** Push a new screen onto the stack. */
  push: (screen: Screen) => void;
  /** Pop the current screen. No-op when on the index. */
  pop: () => void;
  /** Pop all the way back to the index. */
  reset: () => void;
}

/**
 * Best-effort feature check for the History API. happy-dom (our test
 * runner) implements `history.pushState` but not always reliably; we
 * gate the history-side effects so the listener still runs even when
 * pushState isn't fully wired. The popstate fallback drives state in
 * either case.
 */
function hasHistoryApi(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.history !== "undefined" &&
    typeof window.history.pushState === "function"
  );
}

export function useProfileNavStack<Screen extends string>(): NavStack<Screen> {
  const [stack, setStack] = useState<Screen[]>([]);

  // Tracks how many history entries we've appended so unmount/reset can
  // tear them down in a single `history.go(-n)` call without nuking
  // unrelated entries pushed by other parts of the app.
  const pushedCountRef = useRef(0);
  // The popstate listener must observe the latest stack to decide
  // whether to swallow a pop or let it bubble to the platform.
  const stackLengthRef = useRef(0);
  useEffect(() => {
    stackLengthRef.current = stack.length;
  }, [stack.length]);

  const push = useCallback((screen: Screen) => {
    setStack((prev) => [...prev, screen]);
    if (hasHistoryApi()) {
      try {
        window.history.pushState({ profileNav: screen }, "");
        pushedCountRef.current += 1;
      } catch {
        // History API may throw in sandboxed contexts; the in-memory
        // stack still works, just without hardware-back integration.
      }
    }
  }, []);

  const pop = useCallback(() => {
    // Defer to history.back() so the popstate listener is the single
    // source of truth for stack mutation. When history isn't available
    // (or no entry was pushed), fall back to mutating directly.
    if (hasHistoryApi() && pushedCountRef.current > 0) {
      try {
        window.history.back();
        return;
      } catch {
        // fall through to direct mutation
      }
    }
    setStack((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  }, []);

  const reset = useCallback(() => {
    const count = pushedCountRef.current;
    setStack((prev) => (prev.length === 0 ? prev : []));
    pushedCountRef.current = 0;
    if (count > 0 && hasHistoryApi()) {
      try {
        // Roll the history back by the number of entries we pushed.
        window.history.go(-count);
      } catch {
        // No-op: in-memory state is already cleared.
      }
    }
  }, []);

  // popstate listener: any browser/hardware back while a screen is
  // pushed pops the in-memory stack. We don't push a replacement entry
  // here — the platform already removed the entry on its side.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPopState() {
      if (stackLengthRef.current === 0) {
        // Already on the index; let the platform handle the pop. This
        // can happen if other code pushed history entries.
        return;
      }
      setStack((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
      if (pushedCountRef.current > 0) {
        pushedCountRef.current -= 1;
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return useMemo(
    () => ({
      stack,
      current: stack.length === 0 ? null : stack[stack.length - 1],
      isPushed: stack.length > 0,
      push,
      pop,
      reset,
    }),
    [stack, push, pop, reset]
  );
}
