import { useSyncExternalStore } from "react";

/**
 * Detects whether the device is mobile based on user-agent and touch capability.
 * More reliable than viewport width — works correctly on tablets, split-screen, etc.
 * SSR-safe: returns false during server render.
 */

function detectMobile(): boolean {
  const ua = navigator.userAgent;
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const hasTouchScreen = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  // iPad reports as "Macintosh" in modern Safari — detect via touch + Mac UA
  const isIPad = /Macintosh/i.test(ua) && hasTouchScreen;
  return isMobileUA || isIPad;
}

let cachedResult: boolean | null = null;

function subscribe(): () => void {
  return () => {};
}

function getSnapshot(): boolean {
  if (cachedResult === null) {
    cachedResult = detectMobile();
  }
  return cachedResult;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Tailwind's `md` breakpoint. Below this width we render the mobile composition.
 * Kept as a constant so JS-side checks and CSS-side `md:` classes stay in lock-step.
 */
export const MOBILE_BREAKPOINT_PX = 768;

/**
 * Viewport-width-based mobile detector for the mobile redesign shell.
 *
 * Returns true when the window is narrower than the Tailwind `md` breakpoint
 * (768px). Unlike {@link useMobile}, this responds to live resize, so a desktop
 * window resized below 768px (or a tablet rotated to portrait) flips into the
 * mobile composition.
 *
 * Hydration model: implemented via {@link useSyncExternalStore}. The server
 * snapshot is always `false` (we render desktop on the server — the only safe
 * default), and the client snapshot reads `matchMedia` synchronously on the
 * first render. React 19 treats the server/client mismatch from
 * `useSyncExternalStore` as expected and does NOT emit a hydration warning,
 * unlike the previous `useState(false)` + `useEffect` flip pattern, which
 * could surface dev-mode hydration warnings via descendant subtrees that mount
 * differently between the two compositions.
 */
const MOBILE_VIEWPORT_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;

function mobileViewportSubscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(MOBILE_VIEWPORT_QUERY);
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", callback);
    return () => mql.removeEventListener("change", callback);
  }
  // Older Safari fallback.
  mql.addListener(callback);
  return () => mql.removeListener(callback);
}

function mobileViewportGetSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
}

function mobileViewportGetServerSnapshot(): boolean {
  return false;
}

export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(
    mobileViewportSubscribe,
    mobileViewportGetSnapshot,
    mobileViewportGetServerSnapshot
  );
}

/**
 * SSR-safe `prefers-reduced-motion` reader. Returns true when the user has
 * asked the OS to reduce non-essential motion. Components reading this should
 * fall back to instant transitions when it's true.
 *
 * Implemented via {@link useSyncExternalStore} so the FIRST client render
 * already returns the real value (no `useState(false)` → effect flip), which
 * eliminates the one-frame animation flash reduced-motion users would
 * otherwise see on mount. SSR still returns `false` (the only safe default —
 * we can't read `window.matchMedia` on the server), and React reconciles to
 * the real value synchronously on the client's first render.
 */
function reducedMotionSubscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", callback);
    return () => mql.removeEventListener("change", callback);
  }
  // Older Safari fallback.
  mql.addListener(callback);
  return () => mql.removeListener(callback);
}

function reducedMotionGetSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function reducedMotionGetServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    reducedMotionSubscribe,
    reducedMotionGetSnapshot,
    reducedMotionGetServerSnapshot
  );
}

/**
 * Tracks `window.visualViewport.height` so layout can shrink when Android
 * Chrome's gesture bar / browser chrome appears post-fold-transition. CSS
 * `100dvh` over-reports on foldables — `visualViewport` reflects the area
 * actually visible to the user.
 *
 * Returns `null` when `visualViewport` is unavailable (SSR, older browsers,
 * happy-dom in tests) so callers can fall back to `100dvh`.
 */
function visualViewportSubscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || typeof window.visualViewport === "undefined") {
    return () => {};
  }
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", callback);
  vv.addEventListener("scroll", callback);
  return () => {
    vv.removeEventListener("resize", callback);
    vv.removeEventListener("scroll", callback);
  };
}

function visualViewportGetSnapshot(): number | null {
  if (typeof window === "undefined" || typeof window.visualViewport === "undefined") {
    return null;
  }
  return window.visualViewport?.height ?? null;
}

function visualViewportGetServerSnapshot(): number | null {
  return null;
}

export function useVisualViewportHeight(): number | null {
  return useSyncExternalStore(
    visualViewportSubscribe,
    visualViewportGetSnapshot,
    visualViewportGetServerSnapshot
  );
}
