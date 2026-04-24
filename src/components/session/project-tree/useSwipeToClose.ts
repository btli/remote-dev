"use client";

import type React from "react";
import { useCallback, useRef, useState } from "react";

/**
 * Mobile swipe-to-close hook for session rows (Phase F2).
 *
 * Behavior:
 * 1. `handleTouchStart(e, sessionId)` records the start position.
 * 2. `handleTouchMove(e)` tracks the finger. On first movement past
 *    `axisDecisionPx` it locks the axis to horizontal or vertical. Vertical
 *    aborts the swipe (lets the scroll proceed). Horizontal clamps rightward
 *    motion to 0 and leftward motion to `-maxDragPx`, calling
 *    `e.preventDefault()` to block page scroll.
 * 3. `handleTouchEnd()` commits the swipe if `|currentDx| >= commitThresholdPx`
 *    (sets `swipedSessionId`). The `currentDx` state always resets on release —
 *    the visible reveal after commit is driven by `swipedSessionId`, not the
 *    drag offset, so the row snaps back to resting and the consumer renders a
 *    separate close button.
 * 4. `clearSwipe()` dismisses a committed reveal — call it after the consumer
 *    finishes handling `onClose`, or on scroll/outside-tap.
 *
 * Desktop behavior: when `enabled` is false the handlers are no-ops.
 */

export interface UseSwipeToCloseInput {
  enabled: boolean;
  onClose: (sessionId: string) => void;
  /**
   * Optional gate — called on touchStart. If it returns false the hook does
   * not engage for that sessionId, allowing the parent to veto swipe on
   * specific rows (e.g. sessions with pending schedules).
   */
  canSwipe?: (sessionId: string) => boolean;
  commitThresholdPx?: number;
  maxDragPx?: number;
  axisDecisionPx?: number;
}

export interface UseSwipeToClose {
  swipedSessionId: string | null;
  getRowStyle: (sessionId: string) => React.CSSProperties;
  handleTouchStart: (
    e: React.TouchEvent<HTMLElement>,
    sessionId: string,
  ) => void;
  handleTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
  handleTouchEnd: () => void;
  clearSwipe: () => void;
}

const DEFAULT_COMMIT_THRESHOLD_PX = 40;
const DEFAULT_MAX_DRAG_PX = 80;
const DEFAULT_AXIS_DECISION_PX = 10;

type Axis = "unknown" | "horizontal" | "vertical";

interface TouchState {
  sessionId: string;
  startX: number;
  startY: number;
  axis: Axis;
}

export function useSwipeToClose(
  input: UseSwipeToCloseInput,
): UseSwipeToClose {
  const {
    enabled,
    canSwipe,
    commitThresholdPx = DEFAULT_COMMIT_THRESHOLD_PX,
    maxDragPx = DEFAULT_MAX_DRAG_PX,
    axisDecisionPx = DEFAULT_AXIS_DECISION_PX,
  } = input;

  const [swipedSessionId, setSwipedSessionId] = useState<string | null>(null);
  const [currentDx, setCurrentDx] = useState(0);
  const touchRef = useRef<TouchState | null>(null);

  const resetTouch = useCallback(() => {
    touchRef.current = null;
    setCurrentDx(0);
  }, []);

  const handleTouchStart = useCallback<UseSwipeToClose["handleTouchStart"]>(
    (e, sessionId) => {
      if (!enabled) return;
      if (canSwipe && !canSwipe(sessionId)) return;
      const touch = e.touches[0];
      if (!touch) return;
      touchRef.current = {
        sessionId,
        startX: touch.clientX,
        startY: touch.clientY,
        axis: "unknown",
      };
      setCurrentDx(0);
    },
    [enabled, canSwipe],
  );

  const handleTouchMove = useCallback<UseSwipeToClose["handleTouchMove"]>(
    (e) => {
      const state = touchRef.current;
      if (!state) return;
      const touch = e.touches[0];
      if (!touch) return;

      const dx = touch.clientX - state.startX;
      const dy = touch.clientY - state.startY;

      if (state.axis === "unknown") {
        if (
          Math.abs(dx) > axisDecisionPx ||
          Math.abs(dy) > axisDecisionPx
        ) {
          const axis: Axis =
            Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
          if (axis === "vertical") {
            // Abort swipe entirely — let the scroll proceed.
            touchRef.current = null;
            setCurrentDx(0);
            return;
          }
          state.axis = axis;
          touchRef.current = state;
        } else {
          return;
        }
      }

      if (state.axis === "horizontal") {
        // Block page scroll while we're actively handling a horizontal drag.
        if (typeof e.preventDefault === "function") {
          try {
            e.preventDefault();
          } catch {
            // happy-dom / some test envs throw on passive-event preventDefault — ignore.
          }
        }
        let next: number;
        if (dx > 0) {
          next = 0;
        } else {
          next = Math.max(dx, -maxDragPx);
        }
        setCurrentDx(next);
      }
    },
    [axisDecisionPx, maxDragPx],
  );

  const handleTouchEnd = useCallback<UseSwipeToClose["handleTouchEnd"]>(() => {
    const state = touchRef.current;
    if (!state) {
      // No active drag — still ensure we're at rest.
      setCurrentDx(0);
      return;
    }
    if (state.axis === "horizontal" && currentDx <= -commitThresholdPx) {
      setSwipedSessionId(state.sessionId);
    }
    resetTouch();
  }, [currentDx, commitThresholdPx, resetTouch]);

  const clearSwipe = useCallback(() => {
    setSwipedSessionId(null);
    resetTouch();
  }, [resetTouch]);

  const getRowStyle = useCallback<UseSwipeToClose["getRowStyle"]>(
    (sessionId) => {
      const state = touchRef.current;
      const isActiveDrag =
        state != null &&
        state.sessionId === sessionId &&
        state.axis === "horizontal" &&
        currentDx < 0;
      if (isActiveDrag) {
        return {
          transform: `translateX(${currentDx}px)`,
          transition: "none",
        };
      }
      // After commit, keep the row translated so the revealed close button
      // stays visible until the user taps it or the swipe is cleared.
      // Without this the row snaps back over the button on touchend.
      if (swipedSessionId === sessionId) {
        return {
          transform: `translateX(${-maxDragPx}px)`,
          transition: "transform 200ms ease-out",
        };
      }
      return {
        transform: "translateX(0)",
        transition: "transform 200ms ease-out",
      };
    },
    [currentDx, swipedSessionId, maxDragPx],
  );

  return {
    swipedSessionId,
    getRowStyle,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    clearSwipe,
  };
}
