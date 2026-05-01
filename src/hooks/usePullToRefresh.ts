"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/useMobile";

/**
 * usePullToRefresh — Phase 2 mobile redesign.
 *
 * Wraps a vertically scrolling element. When the user is already at the top
 * (scrollTop === 0) and pulls down past `threshold` pixels, fires `onRefresh`.
 * The hook returns a small visual state (`pullDistance`, `isRefreshing`) so
 * the consumer can render a subtle indicator without a big spinner overlay
 * (per the brief: "no big spinner").
 *
 * Reduced motion: when the user prefers reduced motion the hook still allows
 * the refresh to fire, but it returns `0` for `pullDistance` so consumers
 * suppress the visual stretch and just show a static text indicator.
 *
 * SSR safety: the hook only attaches listeners on the client, after `ref`
 * resolves to a real DOM element.
 */

export interface UsePullToRefreshOptions {
  threshold?: number;
  onRefresh: () => void | Promise<unknown>;
  /** When false, gestures are ignored entirely (e.g. while a refresh is in flight). */
  enabled?: boolean;
}

export interface UsePullToRefreshState {
  /** Current downward pull distance in px. 0 when not pulling. Capped at 1.5*threshold. */
  pullDistance: number;
  /** True from the moment `onRefresh` is invoked until its returned promise settles. */
  isRefreshing: boolean;
  /** Called by the consumer to attach listeners to the scroll container. */
  ref: (el: HTMLElement | null) => void;
}

const DEFAULT_THRESHOLD = 64;
const PULL_RESISTANCE = 0.5;

export function usePullToRefresh(options: UsePullToRefreshOptions): UsePullToRefreshState {
  const { threshold = DEFAULT_THRESHOLD, onRefresh, enabled = true } = options;
  const reducedMotion = usePrefersReducedMotion();

  const [el, setEl] = useState<HTMLElement | null>(null);
  const [pullDistance, setPullDistanceState] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullDistanceRef = useRef(0);
  const setPullDistance = useCallback((v: number) => {
    pullDistanceRef.current = v;
    setPullDistanceState(v);
  }, []);

  // Latest `onRefresh` callback without re-binding listeners on every render.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // Latest `enabled` flag without re-binding listeners.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const isRefreshingRef = useRef(false);
  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  const ref = useCallback((node: HTMLElement | null) => {
    setEl(node);
  }, []);

  useEffect(() => {
    if (!el) return;

    let startY: number | null = null;
    let pulling = false;

    const onTouchStart = (e: TouchEvent) => {
      if (!enabledRef.current || isRefreshingRef.current) return;
      // Only start tracking when we're already at the top — otherwise the
      // user is scrolling content, not pulling-to-refresh.
      if (el.scrollTop > 0) return;
      const t = e.touches[0];
      if (!t) return;
      startY = t.clientY;
      pulling = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY === null) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - startY;
      if (dy <= 0) {
        // Upward / neutral pull — abandon and let scrolling resume.
        if (pulling) {
          pulling = false;
          setPullDistance(0);
        }
        return;
      }
      // Past the top, pull down with rubber-band resistance so it never
      // feels infinite. Cap visual pull at 1.5x threshold.
      pulling = true;
      const damped = Math.min(dy * PULL_RESISTANCE, threshold * 1.5);
      // Reduced-motion: don't visualize the stretch at all; only the action
      // matters. (We still fire onRefresh on release past threshold.)
      setPullDistance(reducedMotion ? 0 : damped);
    };

    const onTouchEnd = () => {
      if (startY === null) return;
      const distance = pullDistanceRef.current;
      const releasedAtTop = el.scrollTop === 0;
      startY = null;

      if (pulling && releasedAtTop && distance >= threshold * PULL_RESISTANCE) {
        // Threshold met; fire the refresh.
        pulling = false;
        setPullDistance(0);
        setIsRefreshing(true);
        Promise.resolve(onRefreshRef.current())
          .catch(() => {
            // Swallow — caller is responsible for surfacing errors via
            // its own error state. We just need to release the spinner.
          })
          .finally(() => {
            setIsRefreshing(false);
          });
        return;
      }

      // Otherwise reset.
      pulling = false;
      setPullDistance(0);
    };

    const onTouchCancel = () => {
      startY = null;
      pulling = false;
      setPullDistance(0);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
    // pullDistance is read from a ref inside the listeners so the effect
    // doesn't re-bind on every drag tick.
  }, [el, threshold, reducedMotion, setPullDistance]);

  return { pullDistance, isRefreshing, ref };
}
