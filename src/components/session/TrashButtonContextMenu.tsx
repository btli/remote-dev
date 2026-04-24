"use client";
import { type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { Trash2 } from "lucide-react";

interface ContentProps {
  onEmptyPermanently: () => void;
}

/**
 * Exported for direct testing without requiring Radix menu context.
 * Renders plain buttons so the content can be unit-tested in isolation.
 */
export function TrashButtonContextMenuContent({
  onEmptyPermanently,
}: ContentProps) {
  return (
    <div role="menu">
      <button
        role="menuitem"
        onClick={onEmptyPermanently}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="mr-2 h-4 w-4" /> Empty Permanently
      </button>
    </div>
  );
}

interface Props extends ContentProps {
  children: ReactNode;
}

/**
 * Right-click affordance on the sidebar footer Trash button. Restores the
 * legacy "Empty Permanently" escape hatch removed in Phase G; the primary
 * click opens the Trash terminal-tab (handled by the parent).
 *
 * See remote-dev-mtv7.7.
 */
export function TrashButtonContextMenu({
  onEmptyPermanently,
  children,
}: Props) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={onEmptyPermanently}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Empty Permanently
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
