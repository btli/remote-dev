"use client";

/**
 * usePinchZoom, Phase 3 mobile session view.
 *
 * Two-finger pinch detector. Calls `onScale(factor)` while the user is
 * actively pinching, where `factor` is the ratio of current finger
 * distance to initial finger distance, clamped to a reasonable range so
 * the consumer doesn't accidentally crank the font size to 80px.
 *
 * The hook attaches native (non-passive) `touchstart` / `touchmove`
 * listeners imperatively via a ref callback. This is deliberate: React's
 * synthetic touch handlers are passive, and `touch-action: pan-y` alone
 * is not enough on iOS Safari 15+, where the browser may stop firing
 * `touchmove` for two-finger gestures on a `pan-y` element. Owning the
 * listener with `{ passive: false }` lets us call `preventDefault()` for
 * multi-touch and keep pinch firing reliably while still allowing
 * single-finger vertical pan-through to native scroll.
 *
 * The hook also debounces the call into a single trailing notification
 * per gesture-end via `onScaleCommit(factor)`. Consumers can persist the
 * resulting font size on commit and ignore the rapid in-flight updates.
 */

import { useCallback, useEffect, useRef } from "react";

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

export interface PinchZoomBind {
  /** Attach to the host element via `ref={pinch.ref}`. */
  ref: (node: HTMLElement | null) => void;
}

const DEFAULT_THRESHOLD = 12;
const MIN_FACTOR = 0.6;
const MAX_FACTOR = 1.8;

function fingerDistance(t1: Touch, t2: Touch): number {
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

  // Latest callback refs so the effect doesn't re-bind on every render.
  const onScaleRef = useRef(onScale);
  const onScaleCommitRef = useRef(onScaleCommit);
  const thresholdRef = useRef(thresholdPx);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    onScaleRef.current = onScale;
    onScaleCommitRef.current = onScaleCommit;
    thresholdRef.current = thresholdPx;
    enabledRef.current = enabled;
  }, [onScale, onScaleCommit, thresholdPx, enabled]);

  // The currently bound element + its detach function. We use a ref
  // callback rather than `useEffect(() => ref.current)` so that swapping
  // the element in/out (e.g. when the parent unmounts/remounts the
  // viewport) cleans up listeners deterministically.
  const detachRef = useRef<(() => void) | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    if (detachRef.current) {
      detachRef.current();
      detachRef.current = null;
    }
    if (!node) return;

    let startDist: number | null = null;
    let lastFactor = 1;

    const onTouchStart = (e: TouchEvent) => {
      if (!enabledRef.current) return;
      if (e.touches.length !== 2) {
        startDist = null;
        return;
      }
      startDist = fingerDistance(e.touches[0], e.touches[1]);
      lastFactor = 1;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!enabledRef.current || startDist === null) return;
      if (e.touches.length !== 2) return;
      // Owning the gesture: prevent the browser's native pinch-zoom
      // from running in parallel with our font scaling. Requires the
      // listener be registered with { passive: false }.
      e.preventDefault();
      const dist = fingerDistance(e.touches[0], e.touches[1]);
      if (Math.abs(dist - startDist) < thresholdRef.current) return;
      const factor = Math.max(
        MIN_FACTOR,
        Math.min(MAX_FACTOR, dist / startDist)
      );
      lastFactor = factor;
      onScaleRef.current?.(factor);
    };

    const finishGesture = () => {
      if (startDist === null) return;
      const final = lastFactor;
      startDist = null;
      lastFactor = 1;
      if (Math.abs(final - 1) > 0.001) {
        onScaleCommitRef.current?.(final);
      }
    };

    node.addEventListener("touchstart", onTouchStart, { passive: false });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", finishGesture);
    node.addEventListener("touchcancel", finishGesture);

    detachRef.current = () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", finishGesture);
      node.removeEventListener("touchcancel", finishGesture);
    };
  }, []);

  // Detach on unmount.
  useEffect(() => {
    return () => {
      if (detachRef.current) {
        detachRef.current();
        detachRef.current = null;
      }
    };
  }, []);

  return { ref };
}
