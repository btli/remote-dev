"use client";

/**
 * useThreadTakeoverSwipe — left-edge back gesture for the mobile thread
 * takeover.
 *
 * Detects a swipe that BEGINS within the leftmost `edgeThresholdPx` (default
 * 24px) of the takeover panel and travels rightward past `horizontalThresholdPx`
 * (default 64px) without enough vertical drift to look like a list scroll. On
 * trigger it fires `onDismiss`. Returns a `dragging` flag and `dragOffsetPx`
 * so the host panel can follow the finger one-to-one until release; the host
 * decides whether to commit (≥ threshold) or rubber-band back to 0.
 *
 * Mirrors the iOS interactive-pop-gesture model: the user gets continuous
 * visual feedback and a clear point of no return. Reduced motion is the
 * caller's concern — this hook reports raw deltas, the panel's transition
 * already short-circuits to 0ms when reduced-motion is set.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseThreadTakeoverSwipeOptions {
  edgeThresholdPx?: number;
  horizontalThresholdPx?: number;
  enabled?: boolean;
  onDismiss: () => void;
}

export interface UseThreadTakeoverSwipeState {
  /** True once a valid edge-drag has begun. */
  dragging: boolean;
  /** Live horizontal offset (≥ 0). 0 when not dragging or after release. */
  dragOffsetPx: number;
  bind: {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
}

const DEFAULT_EDGE = 24;
const DEFAULT_HORIZONTAL = 64;

export function useThreadTakeoverSwipe(
  options: UseThreadTakeoverSwipeOptions
): UseThreadTakeoverSwipeState {
  const {
    edgeThresholdPx = DEFAULT_EDGE,
    horizontalThresholdPx = DEFAULT_HORIZONTAL,
    enabled = true,
    onDismiss,
  } = options;

  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const trackingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);

  const reset = useCallback(() => {
    startX.current = null;
    startY.current = null;
    trackingRef.current = false;
    setDragging(false);
    setDragOffsetPx(0);
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (!enabled) return;
      const t = e.touches[0];
      if (!t) return;
      // Read the panel's left edge (in viewport coords) from the target
      // element so the gesture works whether the panel sits at x=0 (full
      // takeover) or is otherwise positioned.
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (t.clientX - rect.left > edgeThresholdPx) {
        // Start was not near the left edge — let the inner content handle
        // the touch (scroll, link tap, etc.).
        return;
      }
      startX.current = t.clientX;
      startY.current = t.clientY;
      trackingRef.current = true;
      setDragging(false);
      setDragOffsetPx(0);
    },
    [enabled, edgeThresholdPx]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (!trackingRef.current || startX.current === null || startY.current === null) {
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;

      // Vertical-bias: if the user is mostly scrolling, bail out.
      if (Math.abs(dy) > Math.abs(dx) * 0.6 && !dragging) {
        reset();
        return;
      }
      // We only react to rightward drags from the left edge.
      if (dx <= 0) {
        if (dragging) {
          setDragging(false);
          setDragOffsetPx(0);
        }
        return;
      }

      setDragging(true);
      setDragOffsetPx(dx);
    },
    [dragging, reset]
  );

  const onTouchEnd = useCallback(() => {
    if (!trackingRef.current) {
      reset();
      return;
    }
    const triggered = dragOffsetPx >= horizontalThresholdPx;
    setDragging(false);
    setDragOffsetPx(0);
    trackingRef.current = false;
    startX.current = null;
    startY.current = null;
    if (triggered) onDismissRef.current();
  }, [dragOffsetPx, horizontalThresholdPx, reset]);

  return {
    dragging,
    dragOffsetPx,
    bind: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: reset,
    },
  };
}
