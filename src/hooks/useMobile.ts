import { useEffect, useState, useSyncExternalStore } from "react";

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
 * mobile composition. SSR-safe: returns false during server render.
 */
export function useIsMobileViewport(): boolean {
  // Always start `false` on both server and first client render so the
  // markup hashes line up — otherwise React 19 throws a hydration mismatch
  // the first time a real mobile user lands on the page. The effect below
  // calls `update()` synchronously on mount, flipping us to the correct
  // value within a single frame, so the visible behavior is unchanged.
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    // Older Safari uses addListener; modern browsers expose addEventListener.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  return isMobile;
}

/**
 * SSR-safe `prefers-reduced-motion` reader. Returns true when the user has
 * asked the OS to reduce non-essential motion. Components reading this should
 * fall back to instant transitions when it's true.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mql.matches);
    update();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  return reduced;
}
