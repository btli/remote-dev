"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SplitDirection = "horizontal" | "vertical";

/** A leaf pane containing a session */
export interface LeafPane {
  type: "leaf";
  id: string; // Unique pane ID
  sessionId: string;
}

/** A container that splits into two children */
export interface ContainerPane {
  type: "container";
  id: string;
  direction: SplitDirection;
  children: [PaneNode, PaneNode];
  /** Size of first child as percentage (0-100) */
  splitRatio: number;
}

export type PaneNode = LeafPane | ContainerPane;

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────────────────────────────────────

let paneIdCounter = 0;
export function generatePaneId(): string {
  return `pane-${++paneIdCounter}-${Date.now()}`;
}

/** Find a pane by ID in the tree */
export function findPane(root: PaneNode, paneId: string): PaneNode | null {
  if (root.id === paneId) return root;
  if (root.type === "container") {
    for (const child of root.children) {
      const found = findPane(child, paneId);
      if (found) return found;
    }
  }
  return null;
}

/** Find the parent of a pane */
export function findParent(
  root: PaneNode,
  paneId: string
): ContainerPane | null {
  if (root.type === "leaf") return null;
  for (const child of root.children) {
    if (child.id === paneId) return root;
    const found = findParent(child, paneId);
    if (found) return found;
  }
  return null;
}

/** Split a leaf pane into a container with the original + new session */
export function splitPane(
  root: PaneNode,
  paneId: string,
  direction: SplitDirection,
  newSessionId: string
): PaneNode {
  if (root.id === paneId && root.type === "leaf") {
    // Replace this leaf with a container
    return {
      type: "container",
      id: generatePaneId(),
      direction,
      splitRatio: 50,
      children: [
        root, // Original pane
        { type: "leaf", id: generatePaneId(), sessionId: newSessionId },
      ],
    };
  }

  if (root.type === "container") {
    return {
      ...root,
      children: [
        splitPane(root.children[0], paneId, direction, newSessionId),
        splitPane(root.children[1], paneId, direction, newSessionId),
      ] as [PaneNode, PaneNode],
    };
  }

  return root;
}

/** Close a pane and promote sibling to parent position */
export function closePane(root: PaneNode, paneId: string): PaneNode | null {
  if (root.type === "leaf") {
    return root.id === paneId ? null : root;
  }

  const [first, second] = root.children;

  // If either child is the target, return the other
  if (first.id === paneId) return second;
  if (second.id === paneId) return first;

  // Recursively close in children
  const newFirst = closePane(first, paneId);
  const newSecond = closePane(second, paneId);

  // If a child was removed, return the remaining one
  if (!newFirst) return newSecond;
  if (!newSecond) return newFirst;

  return {
    ...root,
    children: [newFirst, newSecond] as [PaneNode, PaneNode],
  };
}

/** Update split ratio for a container */
export function updateSplitRatio(
  root: PaneNode,
  containerId: string,
  newRatio: number
): PaneNode {
  if (root.type === "leaf") return root;

  if (root.id === containerId) {
    return { ...root, splitRatio: Math.max(10, Math.min(90, newRatio)) };
  }

  return {
    ...root,
    children: [
      updateSplitRatio(root.children[0], containerId, newRatio),
      updateSplitRatio(root.children[1], containerId, newRatio),
    ] as [PaneNode, PaneNode],
  };
}

/** Get all leaf panes */
export function getAllLeaves(root: PaneNode): LeafPane[] {
  if (root.type === "leaf") return [root];
  return [
    ...getAllLeaves(root.children[0]),
    ...getAllLeaves(root.children[1]),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

interface ResizeHandleProps {
  direction: SplitDirection;
  onDrag: (delta: number) => void;
}

function ResizeHandle({ direction, onDrag }: ResizeHandleProps) {
  const isDragging = useRef(false);
  const startPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startPos.current = direction === "horizontal" ? e.clientX : e.clientY;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const currentPos =
          direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
        const delta = currentPos - startPos.current;
        startPos.current = currentPos;
        onDrag(delta);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [direction, onDrag]
  );

  return (
    <div
      className={cn(
        "group relative flex-shrink-0 z-10",
        direction === "horizontal"
          ? "w-1 cursor-col-resize hover:bg-primary/30"
          : "h-1 cursor-row-resize hover:bg-primary/30",
        "transition-colors"
      )}
      onMouseDown={handleMouseDown}
    >
      {/* Visual indicator on hover */}
      <div
        className={cn(
          "absolute opacity-0 group-hover:opacity-100 transition-opacity",
          "bg-primary/50",
          direction === "horizontal"
            ? "w-1 h-8 top-1/2 -translate-y-1/2 left-0"
            : "h-1 w-8 left-1/2 -translate-x-1/2 top-0"
        )}
      />
    </div>
  );
}

interface SplitPaneContainerProps {
  layout: PaneNode;
  activePaneId: string | null;
  onPaneClick: (paneId: string) => void;
  onPaneClose: (paneId: string) => void;
  onLayoutChange: (newLayout: PaneNode) => void;
  renderTerminal: (sessionId: string) => React.ReactNode;
}

export function SplitPaneContainer({
  layout,
  activePaneId,
  onPaneClick,
  onPaneClose,
  onLayoutChange,
  renderTerminal,
}: SplitPaneContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleResize = useCallback(
    (containerId: string, delta: number, direction: SplitDirection) => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const totalSize =
        direction === "horizontal"
          ? container.getBoundingClientRect().width
          : container.getBoundingClientRect().height;

      const deltaPercent = (delta / totalSize) * 100;

      const currentPane = findPane(layout, containerId) as ContainerPane | null;
      const currentRatio = currentPane?.splitRatio ?? 50;
      onLayoutChange(
        updateSplitRatio(layout, containerId, currentRatio + deltaPercent)
      );
    },
    [layout, onLayoutChange]
  );

  const renderPane = (node: PaneNode): React.ReactNode => {
    if (node.type === "leaf") {
      const isActive = node.id === activePaneId;
      const leaves = getAllLeaves(layout);
      const canClose = leaves.length > 1;

      return (
        <div
          key={node.id}
          className={cn(
            "relative h-full w-full overflow-hidden",
            "ring-inset transition-all duration-150",
            isActive
              ? "ring-2 ring-primary/50"
              : "ring-1 ring-border hover:ring-border/50"
          )}
          onClick={() => onPaneClick(node.id)}
        >
          {/* Close button (only if multiple panes) */}
          {canClose && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "absolute top-1 right-1 z-20 w-5 h-5",
                "bg-card/80 hover:bg-red-500/80",
                "opacity-0 hover:opacity-100 transition-opacity",
                isActive && "opacity-50"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onPaneClose(node.id);
              }}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
          {renderTerminal(node.sessionId)}
        </div>
      );
    }

    // Container pane
    const { direction, splitRatio, children } = node;
    const isHorizontal = direction === "horizontal";

    return (
      <div
        key={node.id}
        ref={node.id === layout.id ? containerRef : undefined}
        className={cn("flex h-full w-full", isHorizontal ? "flex-row" : "flex-col")}
      >
        <div
          style={{
            [isHorizontal ? "width" : "height"]: `${splitRatio}%`,
          }}
          className="overflow-hidden"
        >
          {renderPane(children[0])}
        </div>
        <ResizeHandle
          direction={direction}
          onDrag={(delta) => handleResize(node.id, delta, direction)}
        />
        <div
          style={{
            [isHorizontal ? "width" : "height"]: `${100 - splitRatio}%`,
          }}
          className="overflow-hidden"
        >
          {renderPane(children[1])}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full" ref={containerRef}>
      {renderPane(layout)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Context & Hooks
// ─────────────────────────────────────────────────────────────────────────────

export interface SplitPaneState {
  layout: PaneNode | null;
  activePaneId: string | null;
}

export function createInitialLayout(sessionId: string): PaneNode {
  return {
    type: "leaf",
    id: generatePaneId(),
    sessionId,
  };
}
