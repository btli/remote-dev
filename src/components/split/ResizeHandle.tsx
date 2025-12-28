"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SplitDirection } from "@/types/split";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  direction: SplitDirection;
  onResize: (delta: number) => void;
  onResizeEnd: () => void;
}

export function ResizeHandle({
  direction,
  onResize,
  onResizeEnd,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef<number>(0);
  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPosRef.current = isHorizontal ? e.clientY : e.clientX;
    },
    [isHorizontal]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = isHorizontal ? e.clientY : e.clientX;
      const delta = currentPos - startPosRef.current;
      startPosRef.current = currentPos;
      onResize(delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEnd();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isHorizontal, onResize, onResizeEnd]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        "group flex items-center justify-center shrink-0",
        "hover:bg-primary/30 active:bg-primary/50 transition-colors",
        isHorizontal
          ? "h-1 w-full cursor-row-resize"
          : "w-1 h-full cursor-col-resize",
        isDragging && "bg-primary/50"
      )}
    >
      <div
        className={cn(
          "rounded-full bg-muted-foreground",
          "group-hover:bg-primary group-active:bg-primary/80",
          "transition-colors",
          isHorizontal ? "w-8 h-0.5" : "w-0.5 h-8",
          isDragging && "bg-primary"
        )}
      />
    </div>
  );
}
