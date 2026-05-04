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

/**
 * A "stage" gates an additional commit threshold beyond the primary one.
 * Used for two-stage swipes (iOS Mail style): release before stage 0 → no
 * action, between stage 0 and stage 1 → primary commit, past stage 1 →
 * secondary commit. Stages must be ordered by ascending `threshold`.
 *
 * When `stages` is provided it takes precedence over the legacy
 * `threshold` + `onSwipe` pair.
 */
export interface SwipeStage {
  /** Distance (px, absolute value) at which this stage becomes active. */
  threshold: number;
  /** Fires when the user releases past this stage's threshold but not past
   *  the next stage's threshold. */
  onCommit: () => void;
}

export interface UseSwipeActionOptions {
  direction?: "left" | "right";
  threshold?: number;
  enabled?: boolean;
  /** Single-stage commit handler. Ignored when `stages` is provided. */
  onSwipe?: () => void;
  /**
   * Optional staged commits. Index 0 fires when release distance is in
   * [stages[0].threshold, stages[1].threshold), index 1 fires when past
   * stages[1].threshold, etc. Two stages is the supported case today.
   */
  stages?: SwipeStage[];
}

export interface UseSwipeActionState {
  /**
   * Current horizontal offset (in px). Negative for left swipe, positive
   * for right. 0 when not dragging or after a successful swipe fires.
   */
  offset: number;
  /**
   * Index of the currently-armed stage based on live offset, or -1 when
   * the offset hasn't crossed the first stage. -1 also when stages were
   * not configured (single-stage callers can ignore this).
   */
  stageIndex: number;
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
  const { direction = "left", threshold = DEFAULT_THRESHOLD, onSwipe, enabled = true, stages } = options;

  // Build a stable stage array: prefer explicit `stages`; otherwise derive
  // a single-stage shape from `threshold` + `onSwipe` so the rest of the
  // hook only deals with one model.
  const effectiveStages: SwipeStage[] = stages && stages.length > 0
    ? stages
    : (onSwipe ? [{ threshold, onCommit: onSwipe }] : []);

  const [offset, setOffsetState] = useState(0);
  const offsetRef = useRef(0);
  const setOffset = useCallback((v: number) => {
    offsetRef.current = v;
    setOffsetState(v);
  }, []);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const dragging = useRef(false);

  // Keep the latest stage callbacks in a ref so consumers can pass fresh
  // closures without re-arming the touch handlers each render.
  const stagesRef = useRef(effectiveStages);
  useEffect(() => {
    stagesRef.current = effectiveStages;
  });

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
    const distance = direction === "left" ? -current : current;
    const armed = stagesRef.current;
    // Walk from highest threshold downward and fire the first stage the
    // release distance has cleared. No commit if it's below the lowest
    // threshold.
    let committed: SwipeStage | null = null;
    for (let i = armed.length - 1; i >= 0; i--) {
      const stage = armed[i];
      if (!stage) continue;
      if (distance >= stage.threshold) {
        committed = stage;
        break;
      }
    }
    setOffset(0);
    if (committed) committed.onCommit();
    startX.current = null;
    startY.current = null;
    dragging.current = false;
  }, [direction, reset, setOffset]);

  // Live stage index based on the current offset. Recomputed cheaply on
  // every render — the offset changes during a drag are already triggering
  // re-renders; this just lets consumers swap labels mid-drag.
  let stageIndex = -1;
  if (effectiveStages.length > 0) {
    const distance = direction === "left" ? -offset : offset;
    for (let i = effectiveStages.length - 1; i >= 0; i--) {
      const stage = effectiveStages[i];
      if (!stage) continue;
      if (distance >= stage.threshold) {
        stageIndex = i;
        break;
      }
    }
  }

  return {
    offset,
    stageIndex,
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
