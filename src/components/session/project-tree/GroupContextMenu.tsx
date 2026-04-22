"use client";
import { type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  Folder,
  FolderOpen,
  Pencil,
  Settings,
  Briefcase,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { GroupNode } from "@/contexts/ProjectTreeContext";

interface GroupOption {
  id: string;
  name: string;
}

interface ContentProps {
  group: GroupNode;
  hasCustomPrefs: boolean;
  /** Groups eligible as move targets (caller must exclude self + descendants). */
  moveTargetGroups?: GroupOption[];
  onCreateProject: () => void;
  onCreateSubgroup: () => void;
  onOpenPreferences: () => void;
  onStartEdit: () => void;
  onToggleCollapse?: () => void;
  /** Move this group under a new parent. `null` targets the root. */
  onMoveToGroup?: (newParentGroupId: string | null) => void;
  onDelete: () => void;
}

/**
 * Exported for direct testing without requiring Radix menu context.
 * Renders plain buttons so the content can be unit-tested in isolation.
 */
export function GroupContextMenuContent({
  group,
  hasCustomPrefs,
  moveTargetGroups,
  onCreateProject,
  onCreateSubgroup,
  onOpenPreferences,
  onStartEdit,
  onToggleCollapse,
  onMoveToGroup,
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
      {onToggleCollapse && (
        <button role="menuitem" onClick={onToggleCollapse}>
          {group.collapsed ? (
            <>
              <ChevronDown className="mr-2 h-4 w-4" /> Expand
            </>
          ) : (
            <>
              <ChevronRight className="mr-2 h-4 w-4" /> Collapse
            </>
          )}
        </button>
      )}
      {onMoveToGroup && (
        <div data-testid="move-to-group-submenu">
          <div className="text-xs font-medium text-muted-foreground px-2 py-1">
            Move to Group
          </div>
          <button
            role="menuitem"
            disabled={group.parentGroupId === null}
            onClick={() => {
              if (group.parentGroupId !== null) onMoveToGroup(null);
            }}
          >
            <FolderOpen className="mr-2 h-4 w-4" /> Root (top level)
          </button>
          {(moveTargetGroups ?? []).map((g) => (
            <button
              key={g.id}
              role="menuitem"
              disabled={group.parentGroupId === g.id}
              onClick={() => {
                if (group.parentGroupId !== g.id) onMoveToGroup(g.id);
              }}
            >
              <Folder className="mr-2 h-4 w-4" /> {g.name}
            </button>
          ))}
        </div>
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
  moveTargetGroups,
  onCreateProject,
  onCreateSubgroup,
  onOpenPreferences,
  onStartEdit,
  onToggleCollapse,
  onMoveToGroup,
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
        {onToggleCollapse && (
          <ContextMenuItem onSelect={onToggleCollapse}>
            {group.collapsed ? (
              <>
                <ChevronDown className="mr-2 h-4 w-4" /> Expand
              </>
            ) : (
              <>
                <ChevronRight className="mr-2 h-4 w-4" /> Collapse
              </>
            )}
          </ContextMenuItem>
        )}
        {onMoveToGroup && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderOpen className="mr-2 h-4 w-4" /> Move to Group
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                onSelect={() => onMoveToGroup(null)}
                disabled={group.parentGroupId === null}
              >
                <FolderOpen className="mr-2 h-4 w-4" /> Root (top level)
              </ContextMenuItem>
              {(moveTargetGroups ?? []).map((g) => (
                <ContextMenuItem
                  key={g.id}
                  onSelect={() => onMoveToGroup(g.id)}
                  disabled={group.parentGroupId === g.id}
                >
                  <Folder className="mr-2 h-4 w-4" /> {g.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
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
