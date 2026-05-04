"use client";

/**
 * useFirstRun — localStorage-backed flag for the mobile welcome screen.
 *
 * Phase 6 of the mobile redesign. The first time an authenticated user
 * lands on mobile we want to show {@link MobileWelcomeScreen} (post-CF-Access
 * "Connect GitHub" / "Skip"). Subsequent visits should bypass it.
 *
 * SSR-safe: returns `null` until we've consulted localStorage on the
 * client, so the host can render a neutral placeholder during the first
 * paint and avoid hydration mismatches.
 *
 * The flag deliberately lives in localStorage (not a server-side flag)
 * because the welcome step is a UX nicety, not a security boundary, and
 * because it's per-device — a user reinstalling the PWA on a new phone
 * will see the welcome there too, which is what we want.
 */

import { useCallback, useEffect, useState } from "react";

/**
 * Storage key. Versioned so we can ship a new welcome flow later without
 * resurrecting it for users who already dismissed v1.
 */
export const WELCOME_SEEN_STORAGE_KEY = "remote-dev:mobile:welcome-seen:v1";

export interface UseFirstRunResult {
  /**
   * `true`  — user has never seen the welcome (or storage was cleared).
   * `false` — user has dismissed it and shouldn't see it again.
   * `null`  — we haven't yet read the flag from storage (SSR / first paint).
   */
  isFirstRun: boolean | null;
  /** Mark the welcome as seen. Synchronous against React state, async to storage. */
  markSeen: () => void;
  /** Test/escape hatch: clear the flag so the welcome shows again. */
  reset: () => void;
}

function readFlag(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(WELCOME_SEEN_STORAGE_KEY) !== "1";
  } catch {
    // localStorage can throw in private mode / when disabled. Treat as
    // first-run; the worst case is the user sees the welcome once per
    // session in those modes, which is acceptable.
    return true;
  }
}

export function useFirstRun(): UseFirstRunResult {
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
    setIsFirstRun(readFlag());
  }, []);

  const markSeen = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(WELCOME_SEEN_STORAGE_KEY, "1");
    } catch {
      // Storage failure: still update local state so the welcome closes
      // for this session even if we can't persist.
    }
    setIsFirstRun(false);
  }, []);

  const reset = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(WELCOME_SEEN_STORAGE_KEY);
    } catch {
      // No-op.
    }
    setIsFirstRun(true);
  }, []);

  return { isFirstRun, markSeen, reset };
}
