"use client";

/**
 * useNotificationSwipe — Phase 4 mobile redesign.
 *
 * Wraps the Phase 2 generic {@link useSwipeAction} hook with the two
 * notification-row semantics:
 *
 *   - Swipe LEFT past threshold  → fires `onDelete` (consumer typically
 *     removes the row optimistically and shows a 5s undo toast).
 *   - Swipe RIGHT past threshold → fires `onToggleRead` (consumer flips
 *     `readAt` on the notification).
 *
 * Both gestures share the same threshold (72px) and the same vertical-bias
 * abandon — see {@link useSwipeAction}'s docstring. The two gestures are
 * mutually exclusive on a single drag: whichever direction the touch goes
 * first wins, because each underlying hook's direction-bias drops the other.
 *
 * The hook returns a single `offset` and a single `bind` so the consumer
 * can attach one set of handlers to the row. It composes the two underlying
 * hooks' handlers into one set, while keeping the threshold and motion math
 * inside the canonical hook.
 */

import { useCallback } from "react";

import { useSwipeAction } from "../sessions/useSwipeAction";

export interface UseNotificationSwipeOptions {
  enabled?: boolean;
  /** Threshold in px to trigger a swipe action. Default 72. */
  threshold?: number;
  onDelete: () => void;
  onToggleRead: () => void;
}

export interface UseNotificationSwipeState {
  /** Live horizontal offset in px (negative = swiping left, positive = right). */
  offset: number;
  /** Touch handlers to spread onto the row's outer element. */
  bind: {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
}

export function useNotificationSwipe(
  options: UseNotificationSwipeOptions
): UseNotificationSwipeState {
  const { enabled = true, threshold = 72, onDelete, onToggleRead } = options;

  const left = useSwipeAction({
    direction: "left",
    threshold,
    enabled,
    onSwipe: onDelete,
  });
  const right = useSwipeAction({
    direction: "right",
    threshold,
    enabled,
    onSwipe: onToggleRead,
  });

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      left.bind.onTouchStart(e);
      right.bind.onTouchStart(e);
    },
    [left.bind, right.bind]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      left.bind.onTouchMove(e);
      right.bind.onTouchMove(e);
    },
    [left.bind, right.bind]
  );

  const onTouchEnd = useCallback(() => {
    left.bind.onTouchEnd();
    right.bind.onTouchEnd();
  }, [left.bind, right.bind]);

  const onTouchCancel = useCallback(() => {
    left.bind.onTouchCancel();
    right.bind.onTouchCancel();
  }, [left.bind, right.bind]);

  // Whichever direction is active wins the displayed offset. Their
  // direction-bias guarantees only one of them is non-zero at a time.
  const offset = left.offset !== 0 ? left.offset : right.offset;

  return {
    offset,
    bind: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  };
}
