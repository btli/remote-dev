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
 */

import { useCallback, useMemo, useState } from "react";

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

export function useProfileNavStack<Screen extends string>(): NavStack<Screen> {
  const [stack, setStack] = useState<Screen[]>([]);

  const push = useCallback((screen: Screen) => {
    setStack((prev) => [...prev, screen]);
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  }, []);

  const reset = useCallback(() => {
    setStack((prev) => (prev.length === 0 ? prev : []));
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
