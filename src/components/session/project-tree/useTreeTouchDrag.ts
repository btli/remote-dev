"use client";

import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import type { DragState, DropIndicator } from "./useTreeDragDrop";

/**
 * Mobile long-press touch drag for group/project rows (Phase F1).
 *
 * Production behavior:
 * 1. `handleTouchStart` captures the initial touch position and starts a
 *    long-press timer (default 400ms). If the user moves more than
 *    `moveThresholdPx` (default 10) before the timer fires, the long-press is
 *    canceled (user is scrolling).
 * 2. When the timer fires, we create a visual clone of the row (fixed
 *    position, dimmed original), fire haptic feedback, and call
 *    `input.startDrag(type, id, sourceParentId)` on the shared tree drag hook.
 * 3. `handleTouchMove` (after drag has started) moves the clone with the
 *    finger, hides it briefly, and uses `resolveDropTarget` (which defaults to
 *    `document.elementFromPoint` + `closest("[data-node-id]")`) to find the
 *    hovered row. Calls `input.dragOver(...)` with the resolved target.
 * 4. `handleTouchEnd` clears the clone, restores the original opacity, and
 *    either calls `input.drop(...)` (if a target is resolved) or `cancel()`.
 *
 * Desktop behavior: when `enabled` is false, `handleTouchStart` returns
 * immediately and no timers are scheduled. The existing mouse drag-and-drop
 * hook remains in charge.
 */

export type TouchDragNodeType = "group" | "project";

export interface ResolvedDropTarget {
  nodeType: "group" | "project" | "session";
  nodeId: string;
  rect: { top: number; height: number };
  parentId?: string | null;
}

export interface UseTreeTouchDragInput {
  enabled: boolean;
  startDrag: (
    type: TouchDragNodeType,
    id: string,
    sourceParentId: string | null,
  ) => void;
  dragOver: (
    targetType: "group" | "project" | "session",
    targetId: string,
    clientY: number,
    rect: { top: number; height: number },
    extra?: { targetParentId?: string | null },
  ) => void;
  drop: (
    targetType: "group" | "project" | "session",
    targetId: string,
  ) => { drag: DragState; indicator: DropIndicator } | null;
  cancel: () => void;
  onDropResolved?: (snap: { drag: DragState; indicator: DropIndicator }) => void;
  resolveDropTarget?: (clientX: number, clientY: number) => ResolvedDropTarget | null;
  longPressMs?: number;
  moveThresholdPx?: number;
  haptic?: (pattern?: number | number[]) => void;
}

export interface UseTreeTouchDragHandlers {
  handleTouchStart: (
    e: React.TouchEvent<HTMLElement>,
    type: TouchDragNodeType,
    id: string,
    sourceParentId: string | null,
  ) => void;
  handleTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
  handleTouchEnd: (e: React.TouchEvent<HTMLElement>) => void;
}

const DEFAULT_LONG_PRESS_MS = 400;
const DEFAULT_MOVE_THRESHOLD_PX = 10;

interface TouchDragRefState {
  type: TouchDragNodeType | null;
  id: string | null;
  sourceParentId: string | null;
  startX: number;
  startY: number;
  element: HTMLElement | null;
  clone: HTMLElement | null;
  originalOpacity: string;
  isDragging: boolean;
  lastTarget: ResolvedDropTarget | null;
}

const INITIAL_STATE: TouchDragRefState = {
  type: null,
  id: null,
  sourceParentId: null,
  startX: 0,
  startY: 0,
  element: null,
  clone: null,
  originalOpacity: "",
  isDragging: false,
  lastTarget: null,
};

function defaultResolveDropTarget(
  clientX: number,
  clientY: number,
): ResolvedDropTarget | null {
  if (typeof document === "undefined") return null;
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const host = (el as HTMLElement).closest(
    "[data-node-id]",
  ) as HTMLElement | null;
  if (!host) return null;
  const nodeId = host.dataset.nodeId;
  const nodeType = host.dataset.nodeType as
    | "group"
    | "project"
    | "session"
    | undefined;
  if (!nodeId || !nodeType) return null;
  const parentId = host.dataset.nodeParentId ?? null;
  const rect = host.getBoundingClientRect();
  return {
    nodeId,
    nodeType,
    rect: { top: rect.top, height: rect.height },
    parentId,
  };
}

function defaultHaptic(pattern: number | number[] = 50): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    vibrate?: (p: number | number[]) => boolean;
  };
  if (typeof nav.vibrate !== "function") return;
  try {
    nav.vibrate(pattern);
  } catch {
    // Swallow — haptic feedback is best-effort.
  }
}

export function useTreeTouchDrag(
  input: UseTreeTouchDragInput,
): UseTreeTouchDragHandlers {
  const {
    enabled,
    startDrag,
    dragOver,
    drop,
    cancel,
    onDropResolved,
    resolveDropTarget,
    longPressMs = DEFAULT_LONG_PRESS_MS,
    moveThresholdPx = DEFAULT_MOVE_THRESHOLD_PX,
    haptic,
  } = input;

  const stateRef = useRef<TouchDragRefState>({ ...INITIAL_STATE });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTimer();
    const s = stateRef.current;
    if (s.clone && s.clone.parentNode) {
      s.clone.parentNode.removeChild(s.clone);
    }
    if (s.element) {
      s.element.style.opacity = s.originalOpacity;
    }
    stateRef.current = { ...INITIAL_STATE };
  }, [clearTimer]);

  // Make sure we don't leak timers / clones if the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const initiateDrag = useCallback(
    (element: HTMLElement, clientX: number, clientY: number) => {
      const s = stateRef.current;
      if (!s.id || !s.type) return;

      // Create a visual clone for drag feedback.
      const rect = element.getBoundingClientRect();
      const clone = element.cloneNode(true) as HTMLElement;
      clone.setAttribute("data-rdv-touch-clone", "true");
      clone.style.position = "fixed";
      clone.style.top = `${clientY - 20}px`;
      clone.style.left = `${rect.left}px`;
      clone.style.width = `${element.offsetWidth}px`;
      clone.style.opacity = "0.8";
      clone.style.pointerEvents = "none";
      clone.style.zIndex = "1000";
      clone.style.backgroundColor = "hsl(var(--primary) / 0.3)";
      clone.style.borderRadius = "6px";
      document.body.appendChild(clone);

      s.clone = clone;
      s.isDragging = true;
      s.originalOpacity = element.style.opacity;
      element.style.opacity = "0.5";

      // Haptic feedback.
      if (haptic) {
        haptic(50);
      } else {
        defaultHaptic(50);
      }

      startDrag(s.type, s.id, s.sourceParentId);
    },
    [haptic, startDrag],
  );

  const handleTouchStart = useCallback<
    UseTreeTouchDragHandlers["handleTouchStart"]
  >(
    (e, type, id, sourceParentId) => {
      if (!enabled) return;
      const touch = e.touches[0];
      if (!touch) return;
      const element = e.currentTarget as HTMLElement;

      // Abort any in-flight state first.
      cleanup();

      stateRef.current = {
        type,
        id,
        sourceParentId,
        startX: touch.clientX,
        startY: touch.clientY,
        element,
        clone: null,
        originalOpacity: element.style.opacity,
        isDragging: false,
        lastTarget: null,
      };

      timerRef.current = setTimeout(() => {
        const el = stateRef.current.element;
        if (!el) return;
        initiateDrag(el, stateRef.current.startX, stateRef.current.startY);
      }, longPressMs);
    },
    [enabled, cleanup, initiateDrag, longPressMs],
  );

  const handleTouchMove = useCallback<
    UseTreeTouchDragHandlers["handleTouchMove"]
  >(
    (e) => {
      const s = stateRef.current;
      if (!s.id) return;
      const touch = e.touches[0];
      if (!touch) return;

      if (!s.isDragging) {
        // Still in the pending long-press window — cancel if the user scrolls.
        const dx = Math.abs(touch.clientX - s.startX);
        const dy = Math.abs(touch.clientY - s.startY);
        if (dx > moveThresholdPx || dy > moveThresholdPx) {
          clearTimer();
          stateRef.current = { ...INITIAL_STATE };
        }
        return;
      }

      // Drag is active — move the clone and resolve a drop target.
      if (s.clone) {
        s.clone.style.top = `${touch.clientY - 20}px`;
      }

      const resolver = resolveDropTarget ?? defaultResolveDropTarget;
      let target: ResolvedDropTarget | null = null;
      if (s.clone) {
        const prevDisplay = s.clone.style.display;
        s.clone.style.display = "none";
        target = resolver(touch.clientX, touch.clientY);
        s.clone.style.display = prevDisplay;
      } else {
        target = resolver(touch.clientX, touch.clientY);
      }

      if (!target) {
        s.lastTarget = null;
        return;
      }
      // Don't dragOver onto the source row itself.
      if (target.nodeId === s.id && target.nodeType === s.type) {
        s.lastTarget = null;
        return;
      }

      s.lastTarget = target;
      dragOver(target.nodeType, target.nodeId, touch.clientY, target.rect, {
        targetParentId: target.parentId ?? null,
      });
    },
    [clearTimer, dragOver, moveThresholdPx, resolveDropTarget],
  );

  const handleTouchEnd = useCallback<
    UseTreeTouchDragHandlers["handleTouchEnd"]
  >(
    () => {
      clearTimer();
      const s = stateRef.current;

      // Remove clone, restore original element opacity.
      if (s.clone && s.clone.parentNode) {
        s.clone.parentNode.removeChild(s.clone);
      }
      if (s.element) {
        s.element.style.opacity = s.originalOpacity;
      }

      if (s.isDragging && s.id) {
        if (s.lastTarget) {
          const snap = drop(s.lastTarget.nodeType, s.lastTarget.nodeId);
          if (snap && onDropResolved) {
            onDropResolved(snap);
          }
        } else {
          cancel();
        }
      }
      // Tap (isDragging === false): do nothing; the long-press never fired so
      // there's no drag state to cancel.

      stateRef.current = { ...INITIAL_STATE };
    },
    [cancel, clearTimer, drop, onDropResolved],
  );

  return { handleTouchStart, handleTouchMove, handleTouchEnd };
}
