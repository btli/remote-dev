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
  Pencil,
  Pin,
  PinOff,
  FolderOpen,
  X,
  Clock,
  Trash2,
} from "lucide-react";
import type { TerminalSession } from "@/types/session";

interface ProjectOption {
  id: string;
  name: string;
}

interface SessionContextMenuContentProps {
  session: TerminalSession;
  projects: ProjectOption[];
  onStartEdit: () => void;
  onTogglePin: () => void;
  onMove: (projectId: string | null) => void;
  onSchedule?: () => void;
  onClose: () => void;
}

interface SessionContextMenuProps extends SessionContextMenuContentProps {
  children: ReactNode;
}

/**
 * Exported for direct testing without requiring Radix menu context.
 * Renders plain buttons so the content can be unit-tested in isolation.
 */
export function SessionContextMenuContent({
  session,
  projects,
  onStartEdit,
  onTogglePin,
  onMove,
  onSchedule,
  onClose,
}: SessionContextMenuContentProps) {
  return (
    <div role="menu">
      <button role="menuitem" onClick={onStartEdit}>
        <Pencil className="mr-2 h-4 w-4" /> Rename
      </button>
      <button role="menuitem" onClick={onTogglePin}>
        {session.pinned ? (
          <>
            <PinOff className="mr-2 h-4 w-4" /> Unpin Session
          </>
        ) : (
          <>
            <Pin className="mr-2 h-4 w-4" /> Pin Session
          </>
        )}
      </button>
      {projects.length > 0 && (
        <div data-testid="move-to-project-submenu">
          <div className="text-xs font-medium text-muted-foreground px-2 py-1">
            Move to Project
          </div>
          {session.projectId && (
            <button role="menuitem" onClick={() => onMove(null)}>
              <X className="mr-2 h-4 w-4" /> Remove from Project
            </button>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              role="menuitem"
              disabled={session.projectId === p.id}
              onClick={() => {
                if (session.projectId !== p.id) {
                  onMove(p.id);
                }
              }}
            >
              <FolderOpen className="mr-2 h-4 w-4" /> {p.name}
            </button>
          ))}
        </div>
      )}
      {onSchedule && (
        <button role="menuitem" onClick={onSchedule}>
          <Clock className="mr-2 h-4 w-4" /> Schedule Command
        </button>
      )}
      <hr />
      <button
        role="menuitem"
        onClick={onClose}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="mr-2 h-4 w-4" /> Close Session
      </button>
    </div>
  );
}

export function SessionContextMenu({
  session,
  projects,
  onStartEdit,
  onTogglePin,
  onMove,
  onSchedule,
  onClose,
  children,
}: SessionContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onStartEdit}>
          <Pencil className="mr-2 h-4 w-4" /> Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={onTogglePin}>
          {session.pinned ? (
            <>
              <PinOff className="mr-2 h-4 w-4" /> Unpin Session
            </>
          ) : (
            <>
              <Pin className="mr-2 h-4 w-4" /> Pin Session
            </>
          )}
        </ContextMenuItem>
        {projects.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderOpen className="mr-2 h-4 w-4" /> Move to Project
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {session.projectId && (
                <ContextMenuItem onSelect={() => onMove(null)}>
                  <X className="mr-2 h-4 w-4" /> Remove from Project
                </ContextMenuItem>
              )}
              {projects.map((p) => (
                <ContextMenuItem
                  key={p.id}
                  onSelect={() => onMove(p.id)}
                  disabled={session.projectId === p.id}
                >
                  <FolderOpen className="mr-2 h-4 w-4" /> {p.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {onSchedule && (
          <ContextMenuItem onSelect={onSchedule}>
            <Clock className="mr-2 h-4 w-4" /> Schedule Command
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={onClose}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Close Session
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
