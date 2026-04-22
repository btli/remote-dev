import { useCallback, useState } from "react";

export type DragType = "session" | "project" | "group";

export interface DragState {
  type: DragType;
  id: string;
  sourceParentId: string | null;
}

export interface DropIndicator {
  position: "before" | "after" | "nest";
  targetId: string;
  targetType: DragType;
}

export interface DragOverExtra {
  targetParentId?: string | null;
  draggedPinned?: boolean;
  targetPinned?: boolean;
}

export interface UseTreeDragDropInput {
  collectDescendantGroupIds: (rootId: string) => Set<string>;
}

export interface UseTreeDragDrop {
  drag: DragState | null;
  indicator: DropIndicator | null;
  startDrag: (
    type: DragType,
    id: string,
    sourceParentId: string | null,
  ) => void;
  dragOver: (
    targetType: DragType,
    targetId: string,
    clientY: number,
    rect: { top: number; height: number },
    extra?: DragOverExtra,
  ) => void;
  dragLeave: () => void;
  drop: (
    targetType: DragType,
    targetId: string,
  ) => { drag: DragState; indicator: DropIndicator } | null;
  cancel: () => void;
}

type Band = "top" | "middle" | "bottom";

function classifyBand(
  clientY: number,
  rect: { top: number; height: number },
): Band {
  const relativeY = clientY - rect.top;
  const threshold = rect.height * 0.25;
  if (relativeY < threshold) return "top";
  if (relativeY > rect.height - threshold) return "bottom";
  return "middle";
}

/**
 * Pure function that computes the next DropIndicator given the current drag
 * state, the current dragOver target, and the pointer position within the
 * target row. Factored out of the hook so it can be unit-tested independently
 * and to keep render-time state updates predictable.
 */
export function computeIndicator(
  drag: DragState | null,
  targetType: DragType,
  targetId: string,
  clientY: number,
  rect: { top: number; height: number },
  extra: DragOverExtra,
  collectDescendantGroupIds: (rootId: string) => Set<string>,
): DropIndicator | null {
  if (!drag) return null;

  const band = classifyBand(clientY, rect);

  if (drag.type === "session") {
    if (targetType === "session") {
      if (targetId === drag.id) return null;
      // Cross-project session drags are handled via the parent project row's
      // nest drop target, not the session row itself.
      if (extra.targetParentId !== drag.sourceParentId) return null;
      if (extra.draggedPinned !== extra.targetPinned) return null;
      // Middle band collapses to "after" for session reordering.
      const position: "before" | "after" = band === "top" ? "before" : "after";
      return { position, targetId, targetType: "session" };
    }
    if (targetType === "project") {
      return { position: "nest", targetId, targetType: "project" };
    }
    // targetType === "group": sessions can't live in groups directly.
    return null;
  }

  if (drag.type === "project") {
    if (targetType === "project") {
      if (targetId === drag.id) return null;
      if (extra.targetParentId !== drag.sourceParentId) return null;
      // Only before/after bands are valid targets for project reorder;
      // middle collapses to null (caller has no "nest into project" semantics
      // for a project drag).
      if (band === "top")
        return { position: "before", targetId, targetType: "project" };
      if (band === "bottom")
        return { position: "after", targetId, targetType: "project" };
      return null;
    }
    if (targetType === "group") {
      return { position: "nest", targetId, targetType: "group" };
    }
    // targetType === "session"
    return null;
  }

  // drag.type === "group"
  if (targetType === "group") {
    if (targetId === drag.id) return null;
    // Cycle guard: cannot move a group into itself or any descendant.
    if (collectDescendantGroupIds(drag.id).has(targetId)) return null;

    const sameParent = extra.targetParentId === drag.sourceParentId;
    if (sameParent) {
      const position: "before" | "after" | "nest" =
        band === "top" ? "before" : band === "bottom" ? "after" : "nest";
      return { position, targetId, targetType: "group" };
    }
    // Different parent: only the middle (nest) band is a valid drop —
    // cross-level reordering is not supported through group rows here.
    if (band === "middle") {
      return { position: "nest", targetId, targetType: "group" };
    }
    return null;
  }

  // targetType === "project" | "session" while dragging a group
  return null;
}

function indicatorsEqual(
  a: DropIndicator | null,
  b: DropIndicator | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.position === b.position &&
    a.targetId === b.targetId &&
    a.targetType === b.targetType
  );
}

export function useTreeDragDrop({
  collectDescendantGroupIds,
}: UseTreeDragDropInput): UseTreeDragDrop {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);

  const startDrag = useCallback<UseTreeDragDrop["startDrag"]>(
    (type, id, sourceParentId) => {
      setDrag({ type, id, sourceParentId });
      setIndicator(null);
    },
    [],
  );

  const dragOver = useCallback<UseTreeDragDrop["dragOver"]>(
    (targetType, targetId, clientY, rect, extra = {}) => {
      const next = computeIndicator(
        drag,
        targetType,
        targetId,
        clientY,
        rect,
        extra,
        collectDescendantGroupIds,
      );
      setIndicator((prev) => (indicatorsEqual(prev, next) ? prev : next));
    },
    [drag, collectDescendantGroupIds],
  );

  const dragLeave = useCallback(() => {
    setIndicator(null);
  }, []);

  const cancel = useCallback(() => {
    setDrag(null);
    setIndicator(null);
  }, []);

  const drop = useCallback<UseTreeDragDrop["drop"]>(() => {
    if (!drag || !indicator) {
      setDrag(null);
      setIndicator(null);
      return null;
    }
    const snapshot = { drag, indicator };
    setDrag(null);
    setIndicator(null);
    return snapshot;
  }, [drag, indicator]);

  return {
    drag,
    indicator,
    startDrag,
    dragOver,
    dragLeave,
    drop,
    cancel,
  };
}
