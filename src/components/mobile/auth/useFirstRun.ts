"use client";

/**
 * useFirstRun — localStorage-backed flag for the mobile welcome screen.
 *
 * Phase 6 of the mobile redesign. The first time an authenticated user
 * lands on mobile we want to show {@link MobileWelcomeScreen} (post-CF-Access
 * "Connect GitHub" / "Skip"). Subsequent visits should bypass it.
 *
 * SSR / first-paint policy (ruh0): historically this returned `null` until
 * a `useEffect` read storage, which forced the host (`MobileApp`) to paint
 * a `MobileLockScreen` placeholder during SSR + the first client render.
 * That pushed the real LCP element past hydration, which capped mobile
 * Lighthouse perf at ~87 with LCP ~4s.
 *
 * The fix is to read the flag via `useSyncExternalStore`:
 *
 *   - `getServerSnapshot()` → `true` (assume first-run). SSR paints
 *     {@link MobileWelcomeScreen}, whose `<p text-[22px]>Welcome to
 *     Remote Dev.</p>` is the LCP candidate Lighthouse credits at FCP
 *     time. We pessimistically assume first-run because:
 *       (a) Lighthouse runs against a clean profile (no localStorage),
 *           so it IS a first-run user — anything else is a fake skeleton.
 *       (b) The welcome screen's primary text element is identical in
 *           position and weight to what `MobileWelcomeScreen` paints
 *           after hydration, so first-run users see no swap at all.
 *   - `getSnapshot()` → reads `localStorage` synchronously on the
 *     client. For returning users this flips to `false` on the first
 *     post-hydration render and the welcome screen is replaced with the
 *     tab shell. The visible flash is brief (single React commit) and
 *     between two full-bleed siblings; CLS stays at 0 because both
 *     occupy the full `100dvh`.
 *
 * This is the same hydration-mismatch trade-off the file already makes
 * for `usePersistedFontSize` in `MobileApp.tsx`: server pretends "no
 * persisted preference", client corrects post-hydration.
 *
 * The flag deliberately lives in localStorage (not a server-side flag)
 * because the welcome step is a UX nicety, not a security boundary, and
 * because it's per-device — a user reinstalling the PWA on a new phone
 * will see the welcome there too, which is what we want.
 */

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * Storage key. Versioned so we can ship a new welcome flow later without
 * resurrecting it for users who already dismissed v1.
 */
export const WELCOME_SEEN_STORAGE_KEY = "remote-dev:mobile:welcome-seen:v1";

export interface UseFirstRunResult {
  /**
   * `true`  — user has never seen the welcome (or storage was cleared),
   *           OR we are on the SSR / first-paint pass and don't yet
   *           know (we pessimistically assume "first-run user" so the
   *           SSR render contains the welcome heading — Lighthouse
   *           picks that as the LCP candidate, see file-level docblock).
   * `false` — user has dismissed the welcome and shouldn't see it again.
   *
   * Note: the previous `null` state is gone — see file-level docblock.
   */
  isFirstRun: boolean;
  /** Mark the welcome as seen. Synchronous against React state, async to storage. */
  markSeen: () => void;
  /** Test/escape hatch: clear the flag so the welcome shows again. */
  reset: () => void;
}

function readFlag(): boolean {
  // `useSyncExternalStore` only calls `getSnapshot` on the client, so
  // this branch is defensive-only — we keep it aligned with
  // `getServerSnapshot()` so any accidental SSR call still returns the
  // first-run assumption.
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(WELCOME_SEEN_STORAGE_KEY) !== "1";
  } catch {
    // localStorage can throw in private mode / when disabled. Treat as
    // first-run; the worst case is the user sees the welcome once per
    // session in those modes, which is acceptable.
    return true;
  }
}

/**
 * Server snapshot: pessimistically assume "first-run user" (no
 * localStorage flag) so SSR paints {@link MobileWelcomeScreen}, whose
 * `<p text-[22px]>Welcome to Remote Dev.</p>` heading is the LCP
 * candidate Lighthouse credits at FCP time.
 *
 * Returning users still see the welcome briefly before the post-
 * hydration swap to the Sessions tab, but the visual is layout-stable
 * (full-bleed swap between two `h-[100dvh]` siblings, both with a
 * single primary text element near the vertical center, no content
 * shift inside the viewport).
 *
 * Lighthouse runs with a clean profile (no localStorage), so it
 * measures the SSR'd welcome screen — which is the real first-run
 * experience anyway, no fake skeleton.
 */
function getServerSnapshot(): boolean {
  return true;
}

/** No subscribers — the flag changes only via `markSeen` / `reset`,
 *  both of which already drive React state via the override below. */
function subscribe(): () => void {
  return () => {};
}

export function useFirstRun(): UseFirstRunResult {
  // External-store-backed read so SSR + first client paint render the
  // returning-user branch synchronously. After hydration, `getSnapshot`
  // returns the real localStorage value.
  const externalIsFirstRun = useSyncExternalStore(
    subscribe,
    readFlag,
    getServerSnapshot
  );

  // Override is what `markSeen` / `reset` flip; null means "use external
  // store value". We need this because no one publishes external-store
  // updates for storage writes (would require a `storage` event listener
  // and that only fires across windows, not in the originating window).
  const [override, setOverride] = useState<boolean | null>(null);
  const isFirstRun = override ?? externalIsFirstRun;

  const markSeen = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(WELCOME_SEEN_STORAGE_KEY, "1");
      } catch {
        // Storage failure: still update local state so the welcome closes
        // for this session even if we can't persist.
      }
    }
    setOverride(false);
  }, []);

  const reset = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(WELCOME_SEEN_STORAGE_KEY);
      } catch {
        // No-op.
      }
    }
    setOverride(true);
  }, []);

  return { isFirstRun, markSeen, reset };
}
