"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Phase 2 mobile redesign — generic horizontal swipe gesture detector for
 * a list row. Detects a leftward (or rightward) drag past a threshold and
 * fires `onSwipe`. Returns the live drag offset so the consumer can
 * translate the row content as it drags.
 *
 * The hook deliberately avoids vertical-scroll conflict by ignoring any
 * drag whose vertical delta exceeds half its horizontal delta — gives the
 * scroll container priority when the user is mostly scrolling.
 */

export interface UseSwipeActionOptions {
  direction?: "left" | "right";
  threshold?: number;
  enabled?: boolean;
  onSwipe: () => void;
}

export interface UseSwipeActionState {
  /**
   * Current horizontal offset (in px). Negative for left swipe, positive
   * for right. 0 when not dragging or after a successful swipe fires.
   */
  offset: number;
  /** Touch handlers to spread onto the row's outer element. */
  bind: {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
}

const DEFAULT_THRESHOLD = 72;

export function useSwipeAction(options: UseSwipeActionOptions): UseSwipeActionState {
  const { direction = "left", threshold = DEFAULT_THRESHOLD, onSwipe, enabled = true } = options;

  const [offset, setOffsetState] = useState(0);
  const offsetRef = useRef(0);
  const setOffset = useCallback((v: number) => {
    offsetRef.current = v;
    setOffsetState(v);
  }, []);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const dragging = useRef(false);

  const onSwipeRef = useRef(onSwipe);
  useEffect(() => {
    onSwipeRef.current = onSwipe;
  }, [onSwipe]);

  const reset = useCallback(() => {
    startX.current = null;
    startY.current = null;
    dragging.current = false;
    setOffset(0);
  }, [setOffset]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (!enabled) return;
      const t = e.touches[0];
      if (!t) return;
      startX.current = t.clientX;
      startY.current = t.clientY;
      dragging.current = false;
    },
    [enabled]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (!enabled || startX.current === null || startY.current === null) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;
      // Vertical-bias: if the user is mostly scrolling, abandon this gesture.
      if (Math.abs(dy) > Math.abs(dx) * 0.6) {
        if (dragging.current) {
          dragging.current = false;
          setOffset(0);
        }
        return;
      }
      // Direction-bias: ignore swipes the wrong way.
      if (direction === "left" && dx >= 0) {
        if (dragging.current) {
          dragging.current = false;
          setOffset(0);
        }
        return;
      }
      if (direction === "right" && dx <= 0) {
        if (dragging.current) {
          dragging.current = false;
          setOffset(0);
        }
        return;
      }
      dragging.current = true;
      setOffset(dx);
    },
    [enabled, direction]
  );

  const onTouchEnd = useCallback(() => {
    if (!dragging.current) {
      reset();
      return;
    }
    const current = offsetRef.current;
    const triggered =
      direction === "left" ? current <= -threshold : current >= threshold;
    if (triggered) {
      // Snap back visually first; consumer can show a toast.
      setOffset(0);
      onSwipeRef.current();
    } else {
      setOffset(0);
    }
    startX.current = null;
    startY.current = null;
    dragging.current = false;
  }, [direction, threshold, reset, setOffset]);

  return {
    offset,
    bind: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: reset,
    },
  };
}

/**
 * Phase 2 mobile redesign — long-press detector. Fires `onLongPress` after
 * `duration` ms of holding. Cancels on movement past `moveTolerance` px or
 * on release before duration elapses.
 */
export interface UseLongPressOptions {
  duration?: number;
  moveTolerance?: number;
  enabled?: boolean;
  onLongPress: () => void;
}

const LONG_PRESS_DEFAULT = 500;

export function useLongPress(options: UseLongPressOptions) {
  const { duration = LONG_PRESS_DEFAULT, moveTolerance = 8, onLongPress, enabled = true } = options;
  const timer = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  const onLongPressRef = useRef(onLongPress);
  useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    startX.current = null;
    startY.current = null;
  }, []);

  const beginPress = useCallback(
    (clientX: number, clientY: number) => {
      if (!enabled) return;
      startX.current = clientX;
      startY.current = clientY;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        onLongPressRef.current();
      }, duration);
    },
    [enabled, duration]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button && e.button !== 0) return;
      beginPress(e.clientX, e.clientY);
    },
    [beginPress]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (timer.current === null) return;
      if (startX.current === null || startY.current === null) return;
      const dx = e.clientX - startX.current;
      const dy = e.clientY - startY.current;
      if (Math.hypot(dx, dy) > moveTolerance) {
        cancel();
      }
    },
    [moveTolerance, cancel]
  );

  // Fallback handlers for environments that don't dispatch PointerEvents (some
  // older browsers and test environments). Touch drives long-press on real
  // phones; mouse covers desktop-test runners. The first to fire wins; the
  // others are no-ops because the timer is already armed.
  const onTouchStartLP = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (timer.current !== null) return;
      const t = e.touches[0];
      if (!t) return;
      beginPress(t.clientX, t.clientY);
    },
    [beginPress]
  );
  const onMouseDownLP = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (timer.current !== null) return;
      if (e.button && e.button !== 0) return;
      beginPress(e.clientX, e.clientY);
    },
    [beginPress]
  );

  return {
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onTouchStart: onTouchStartLP,
      onMouseDown: onMouseDownLP,
      onMouseUp: cancel,
      onMouseLeave: cancel,
    },
    cancel,
  };
}
