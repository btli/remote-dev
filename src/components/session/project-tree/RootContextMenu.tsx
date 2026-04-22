"use client";
import { type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { FolderPlus, Briefcase } from "lucide-react";

interface ContentProps {
  onNewGroup: () => void;
  onNewProject: () => void;
}

/**
 * Exported for direct testing without requiring Radix menu context.
 * Renders plain buttons so the content can be unit-tested in isolation.
 */
export function RootContextMenuContent({
  onNewGroup,
  onNewProject,
}: ContentProps) {
  return (
    <div role="menu">
      <button role="menuitem" onClick={onNewGroup}>
        <FolderPlus className="mr-2 h-4 w-4" /> New Group
      </button>
      <button role="menuitem" onClick={onNewProject}>
        <Briefcase className="mr-2 h-4 w-4" /> New Project
      </button>
    </div>
  );
}

interface Props extends ContentProps {
  children: ReactNode;
}

export function RootContextMenu({
  onNewGroup,
  onNewProject,
  children,
}: Props) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onNewGroup}>
          <FolderPlus className="mr-2 h-4 w-4" /> New Group
        </ContextMenuItem>
        <ContextMenuItem onSelect={onNewProject}>
          <Briefcase className="mr-2 h-4 w-4" /> New Project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
