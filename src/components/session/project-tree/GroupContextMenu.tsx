"use client";
import { type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  Folder,
  FolderOpen,
  Pencil,
  Settings,
  Briefcase,
  Trash2,
} from "lucide-react";
import type { GroupNode } from "@/contexts/ProjectTreeContext";

interface ContentProps {
  group: GroupNode;
  hasCustomPrefs: boolean;
  onCreateProject: () => void;
  onCreateSubgroup: () => void;
  onOpenPreferences: () => void;
  onStartEdit: () => void;
  onMoveToRoot: () => void;
  onDelete: () => void;
}

/**
 * Exported for direct testing without requiring Radix menu context.
 * Renders plain buttons so the content can be unit-tested in isolation.
 */
export function GroupContextMenuContent({
  group,
  hasCustomPrefs,
  onCreateProject,
  onCreateSubgroup,
  onOpenPreferences,
  onStartEdit,
  onMoveToRoot,
  onDelete,
}: ContentProps) {
  return (
    <div role="menu">
      <button role="menuitem" onClick={onCreateProject}>
        <Briefcase className="mr-2 h-4 w-4" /> New Project
      </button>
      <button role="menuitem" onClick={onCreateSubgroup}>
        <Folder className="mr-2 h-4 w-4" /> New Subgroup
      </button>
      <hr />
      <button role="menuitem" onClick={onOpenPreferences}>
        <Settings className="mr-2 h-4 w-4" />
        Preferences
        {hasCustomPrefs && (
          <span className="ml-auto text-[10px] text-primary">Custom</span>
        )}
      </button>
      <button role="menuitem" onClick={onStartEdit}>
        <Pencil className="mr-2 h-4 w-4" /> Rename
      </button>
      {group.parentGroupId !== null && (
        <button role="menuitem" onClick={onMoveToRoot}>
          <FolderOpen className="mr-2 h-4 w-4" /> Move to Root
        </button>
      )}
      <hr />
      <button
        role="menuitem"
        onClick={onDelete}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="mr-2 h-4 w-4" /> Delete
      </button>
    </div>
  );
}

interface Props extends ContentProps {
  children: ReactNode;
}

export function GroupContextMenu({
  group,
  hasCustomPrefs,
  onCreateProject,
  onCreateSubgroup,
  onOpenPreferences,
  onStartEdit,
  onMoveToRoot,
  onDelete,
  children,
}: Props) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onCreateProject}>
          <Briefcase className="mr-2 h-4 w-4" /> New Project
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCreateSubgroup}>
          <Folder className="mr-2 h-4 w-4" /> New Subgroup
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onOpenPreferences}>
          <Settings className="mr-2 h-4 w-4" />
          Preferences
          {hasCustomPrefs && (
            <span className="ml-auto text-[10px] text-primary">Custom</span>
          )}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onStartEdit}>
          <Pencil className="mr-2 h-4 w-4" /> Rename
        </ContextMenuItem>
        {group.parentGroupId !== null && (
          <ContextMenuItem onSelect={onMoveToRoot}>
            <FolderOpen className="mr-2 h-4 w-4" /> Move to Root
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
