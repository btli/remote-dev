"use client";

/**
 * TerminalDrawer — Toggleable terminal panel for loop sessions
 *
 * On mobile: slides up from bottom as a full-height overlay
 * On desktop: appears as a bottom panel with drag-to-resize handle
 *
 * The actual Terminal component is always mounted (maintains PTY connection).
 * This component only controls visibility and layout.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, GripHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface TerminalDrawerProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

const MIN_HEIGHT = 150;
const MAX_HEIGHT_RATIO = 0.8;
const DEFAULT_HEIGHT = 300;

export function TerminalDrawer({
  visible,
  onClose,
  children,
}: TerminalDrawerProps) {
  const isMobile = useMobile();
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(DEFAULT_HEIGHT);

  const handleDragMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - e.clientY;
      const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;
      const newHeight = Math.max(
        MIN_HEIGHT,
        Math.min(maxHeight, startHeight.current + delta)
      );
      setHeight(newHeight);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    dragging.current = false;
    document.removeEventListener("pointermove", handleDragMove);
    document.removeEventListener("pointerup", handleDragEnd);
  }, [handleDragMove]);

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (isMobile) return;
      dragging.current = true;
      startY.current = e.clientY;
      startHeight.current = height;
      document.addEventListener("pointermove", handleDragMove);
      document.addEventListener("pointerup", handleDragEnd);
    },
    [height, isMobile, handleDragMove, handleDragEnd]
  );

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener("pointermove", handleDragMove);
      document.removeEventListener("pointerup", handleDragEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  if (!visible) {
    // Keep children mounted but hidden to maintain WebSocket connection
    return (
      <div className="h-0 w-0 overflow-hidden pointer-events-none absolute">
        {children}
      </div>
    );
  }

  // Mobile: full-screen overlay
  if (isMobile) {
    return (
      <div className="absolute inset-0 z-40 flex flex-col bg-background">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-medium text-muted-foreground">
            Terminal
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 relative">{children}</div>
      </div>
    );
  }

  // Desktop: bottom panel with resize handle
  return (
    <div
      className="relative border-t border-border bg-background"
      style={{ height }}
    >
      {/* Resize handle */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-2 -translate-y-1/2 z-10",
          "flex items-center justify-center cursor-row-resize",
          "hover:bg-primary/10 transition-colors"
        )}
        onPointerDown={handleDragStart}
      >
        <GripHorizontal className="w-4 h-4 text-muted-foreground/40" />
      </div>

      {/* Close button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1 z-10 h-6 w-6"
        onClick={onClose}
      >
        <X className="w-3.5 h-3.5" />
      </Button>

      {/* Terminal content */}
      <div className="w-full h-full">{children}</div>
    </div>
  );
}
