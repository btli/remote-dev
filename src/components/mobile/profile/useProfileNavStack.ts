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
 * `{ profileNav: { depth, screen } }`. The popstate listener reconciles
 * against `event.state` rather than blindly slicing, so other history
 * actors (hash links, deep links, etc.) can't desync the stack.
 *
 * Unmount: if the user is mid-stack and `ProfileTab` unmounts (e.g.
 * tab switch), the cleanup rolls history back by the number of owned
 * entries — otherwise those entries leak and Browser Back appears
 * broken (consuming invisible entries).
 *
 * Double-tap: a pending-pop guard prevents a fast double-tap on the
 * back chevron from issuing two `history.back()` calls before the
 * first `popstate` fires (which would otherwise leave the app).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The shape we embed into `history.pushState`'s state arg. Reading this
 * back in the popstate handler lets us reconcile with the *intended*
 * stack depth rather than guessing.
 */
interface ProfileNavHistoryState {
  /**
   * Stack depth this history entry corresponds to (1-based: a depth of
   * 1 means "first pushed screen sits on top"). Absent for entries we
   * didn't push.
   */
  depth: number;
  /** Screen identifier — only used for diagnostics. */
  screen: string;
}

interface ReadableState {
  profileNav?: ProfileNavHistoryState;
}

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

/**
 * Window in which a follow-up `pop()` is suppressed if the popstate
 * event hasn't fired yet. Prevents a fast double-tap on the back
 * chevron from issuing two `history.back()` calls (which can leave
 * the app entirely instead of going back one screen).
 */
const PENDING_POP_TIMEOUT_MS = 600;

export function useProfileNavStack<Screen extends string>(): NavStack<Screen> {
  const [stack, setStack] = useState<Screen[]>([]);

  // Tracks how many history entries we've appended so unmount/reset can
  // tear them down in a single `history.go(-n)` call without nuking
  // unrelated entries pushed by other parts of the app.
  const pushedCountRef = useRef(0);
  // The popstate listener must observe the latest stack to decide
  // whether to swallow a pop or let it bubble to the platform.
  const stackLengthRef = useRef(0);
  // Suppresses follow-up `pop()` calls while a `history.back()` is in
  // flight. Cleared on popstate or after a timeout fallback.
  const pendingPopRef = useRef(false);
  const pendingPopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the cleanup path should roll back history. We set
  // this to `false` in `reset()` so we don't double-roll.
  const shouldRollbackOnUnmountRef = useRef(true);

  useEffect(() => {
    stackLengthRef.current = stack.length;
  }, [stack.length]);

  function clearPendingPop() {
    pendingPopRef.current = false;
    if (pendingPopTimerRef.current !== null) {
      clearTimeout(pendingPopTimerRef.current);
      pendingPopTimerRef.current = null;
    }
  }

  const push = useCallback((screen: Screen) => {
    setStack((prev) => {
      const nextDepth = prev.length + 1;
      if (hasHistoryApi()) {
        try {
          const state: ReadableState = {
            profileNav: { depth: nextDepth, screen },
          };
          window.history.pushState(state, "");
          pushedCountRef.current += 1;
        } catch {
          // History API may throw in sandboxed contexts; the in-memory
          // stack still works, just without hardware-back integration.
        }
      }
      return [...prev, screen];
    });
  }, []);

  const pop = useCallback(() => {
    // Defer to history.back() so the popstate listener is the single
    // source of truth for stack mutation. When history isn't available
    // (or no entry was pushed), fall back to mutating directly.
    if (hasHistoryApi() && pushedCountRef.current > 0) {
      // Double-tap guard: if a previous pop is still in flight, drop
      // the second invocation to avoid issuing two history.back() calls.
      if (pendingPopRef.current) {
        return;
      }
      pendingPopRef.current = true;
      pendingPopTimerRef.current = setTimeout(() => {
        // Fallback for browsers that swallowed the popstate event.
        pendingPopRef.current = false;
        pendingPopTimerRef.current = null;
      }, PENDING_POP_TIMEOUT_MS);
      try {
        window.history.back();
        return;
      } catch {
        // fall through to direct mutation
        clearPendingPop();
      }
    }
    setStack((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  }, []);

  const reset = useCallback(() => {
    const count = pushedCountRef.current;
    setStack((prev) => (prev.length === 0 ? prev : []));
    pushedCountRef.current = 0;
    // Reset already drained owned entries; the unmount path must not
    // try to roll them back a second time.
    shouldRollbackOnUnmountRef.current = false;
    clearPendingPop();
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
  // pushed pops the in-memory stack. We reconcile against
  // `event.state.profileNav.depth` so other history actors (hash
  // changes, in-app deep links, etc.) can't slice our stack into
  // inconsistency.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPopState(event: PopStateEvent) {
      // Whatever the outcome, this popstate satisfies the in-flight
      // back() request.
      clearPendingPop();
      const state = (event.state as ReadableState | null) ?? null;
      const targetDepth = state?.profileNav?.depth ?? 0;
      const currentDepth = stackLengthRef.current;
      if (currentDepth === 0) {
        // Already on the index; let the platform handle the pop.
        return;
      }
      if (targetDepth >= currentDepth) {
        // Forward navigation in history (or unrelated state shape that
        // claims an equal/greater depth). Don't slice.
        return;
      }
      // Either we're leaving the profile area entirely
      // (targetDepth === 0) or we're popping to a shallower depth.
      const removedCount = currentDepth - targetDepth;
      pushedCountRef.current = Math.max(
        0,
        pushedCountRef.current - removedCount
      );
      setStack((prev) => {
        if (prev.length <= targetDepth) return prev;
        return prev.slice(0, targetDepth);
      });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Unmount cleanup: if the host (e.g. ProfileTab) unmounts while we
  // still own pushed history entries, drain them with a single
  // history.go(-n). Otherwise those entries leak: the user switches
  // tabs, hits the OS back button, and consumes invisible entries
  // before actually navigating away. We do NOT reset the in-memory
  // stack here because the hook is going away with the host.
  //
  // Caveat: this triggers popstate events the listener has already
  // unsubscribed from (cleanup runs in reverse-order, so the listener
  // is gone by the time go() schedules its events).
  useEffect(() => {
    return () => {
      clearPendingPop();
      if (
        shouldRollbackOnUnmountRef.current &&
        pushedCountRef.current > 0 &&
        hasHistoryApi()
      ) {
        try {
          window.history.go(-pushedCountRef.current);
        } catch {
          // Best effort; nothing else to do.
        }
        pushedCountRef.current = 0;
      }
    };
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
