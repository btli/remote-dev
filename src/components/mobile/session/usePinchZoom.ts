"use client";

/**
 * usePinchZoom, Phase 3 mobile session view.
 *
 * Two-finger pinch detector. Calls `onScale(factor)` while the user is
 * actively pinching, where `factor` is the ratio of current finger
 * distance to initial finger distance, clamped to a reasonable range so
 * the consumer doesn't accidentally crank the font size to 80px.
 *
 * Touch handlers are attached at the React level by spreading `bind`
 * onto a host element. The hook deliberately doesn't subscribe to
 * `window.touchmove`: that would steal vertical scroll out of the
 * terminal output panel.
 *
 * The hook also debounces the call into a single trailing notification per
 * gesture-end via `onScaleCommit(factor)`. Consumers can persist the
 * resulting font size on commit and ignore the rapid in-flight updates.
 */

import { useCallback, useEffect, useRef } from "react";
import type { Touch as ReactTouch, TouchEvent } from "react";

export interface PinchZoomBind {
  onTouchStart: (e: TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: TouchEvent<HTMLElement>) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

export interface UsePinchZoomOptions {
  /**
   * Called continuously while the user is pinching. `factor` is the live
   * ratio of finger distance (1.0 = no change, 1.2 = pinched apart, 0.8 =
   * pinched together).
   */
  onScale?: (factor: number) => void;
  /**
   * Called once at the end of a gesture with the final factor. Useful for
   * persistence side effects.
   */
  onScaleCommit?: (factor: number) => void;
  /** Minimum distance threshold to treat the gesture as a real pinch. */
  thresholdPx?: number;
  enabled?: boolean;
}

const DEFAULT_THRESHOLD = 12;
const MIN_FACTOR = 0.6;
const MAX_FACTOR = 1.8;

function fingerDistance(t1: ReactTouch, t2: ReactTouch): number {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

export function usePinchZoom(options: UsePinchZoomOptions = {}): PinchZoomBind {
  const {
    onScale,
    onScaleCommit,
    thresholdPx = DEFAULT_THRESHOLD,
    enabled = true,
  } = options;

  const startDistRef = useRef<number | null>(null);
  const lastFactorRef = useRef<number>(1);

  const onScaleRef = useRef(onScale);
  const onScaleCommitRef = useRef(onScaleCommit);
  useEffect(() => {
    onScaleRef.current = onScale;
    onScaleCommitRef.current = onScaleCommit;
  }, [onScale, onScaleCommit]);

  const onTouchStart = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      if (!enabled) return;
      if (e.touches.length !== 2) {
        startDistRef.current = null;
        return;
      }
      const [t1, t2] = [e.touches[0], e.touches[1]];
      startDistRef.current = fingerDistance(t1, t2);
      lastFactorRef.current = 1;
    },
    [enabled]
  );

  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      if (!enabled || startDistRef.current === null) return;
      if (e.touches.length !== 2) return;
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const dist = fingerDistance(t1, t2);
      if (Math.abs(dist - startDistRef.current) < thresholdPx) return;
      const factor = Math.max(
        MIN_FACTOR,
        Math.min(MAX_FACTOR, dist / startDistRef.current)
      );
      lastFactorRef.current = factor;
      onScaleRef.current?.(factor);
    },
    [enabled, thresholdPx]
  );

  const finishGesture = useCallback(() => {
    if (startDistRef.current === null) return;
    const final = lastFactorRef.current;
    startDistRef.current = null;
    lastFactorRef.current = 1;
    if (Math.abs(final - 1) > 0.001) {
      onScaleCommitRef.current?.(final);
    }
  }, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd: finishGesture,
    onTouchCancel: finishGesture,
  };
}
