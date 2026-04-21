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
  Terminal,
  Sparkles,
  History,
  Settings,
  GitBranch,
  KeyRound,
  ExternalLink,
  CircleDot,
  GitPullRequest,
  Pencil,
  Trash2,
} from "lucide-react";
import type { ProjectNode } from "@/contexts/ProjectTreeContext";

interface ContentProps {
  project: ProjectNode;
  hasCustomPrefs: boolean;
  hasActiveSecrets: boolean;
  hasLinkedRepo: boolean;
  hasWorkingDirectory: boolean;
  legacyFolderAvailable: boolean;
  onNewTerminal: () => void;
  onNewAgent: () => void;
  onResume: () => void;
  onAdvanced: () => void;
  onNewWorktree: () => void;
  onOpenPreferences: () => void;
  onOpenSecrets: () => void;
  onOpenRepository: () => void;
  onOpenFolderInOS: () => void;
  onViewIssues?: () => void;
  onViewPRs?: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
}

/**
 * Exported for direct testing without requiring Radix menu context.
 * Renders plain buttons so the content can be unit-tested in isolation.
 */
export function ProjectContextMenuContent({
  hasCustomPrefs,
  hasActiveSecrets,
  hasLinkedRepo,
  hasWorkingDirectory,
  legacyFolderAvailable,
  onNewTerminal,
  onNewAgent,
  onResume,
  onAdvanced,
  onNewWorktree,
  onOpenPreferences,
  onOpenSecrets,
  onOpenRepository,
  onOpenFolderInOS,
  onViewIssues,
  onViewPRs,
  onStartEdit,
  onDelete,
}: ContentProps) {
  return (
    <div role="menu">
      <button role="menuitem" onClick={onNewTerminal}>
        <Terminal className="mr-2 h-4 w-4" /> New Terminal
      </button>
      <button role="menuitem" onClick={onNewAgent}>
        <Sparkles className="mr-2 h-4 w-4" /> New Agent
      </button>
      <button role="menuitem" onClick={onResume}>
        <History className="mr-2 h-4 w-4" /> Resume
      </button>
      <button role="menuitem" onClick={onAdvanced}>
        <Settings className="mr-2 h-4 w-4" /> Advanced…
      </button>
      <button
        role="menuitem"
        onClick={hasLinkedRepo ? onNewWorktree : undefined}
        disabled={!hasLinkedRepo}
        title={
          !hasLinkedRepo
            ? "Link a repository in project preferences first"
            : undefined
        }
        className={!hasLinkedRepo ? "opacity-50" : ""}
      >
        <GitBranch className="mr-2 h-4 w-4" /> New Worktree
      </button>
      <hr />
      <button role="menuitem" onClick={onOpenPreferences}>
        <Settings className="mr-2 h-4 w-4" />
        Preferences
        {hasCustomPrefs && (
          <span className="ml-auto text-[10px] text-primary">Custom</span>
        )}
      </button>
      <button role="menuitem" onClick={onOpenSecrets}>
        <KeyRound className="mr-2 h-4 w-4" />
        Secrets
        {hasActiveSecrets && (
          <span className="ml-auto text-[10px] text-primary">Active</span>
        )}
      </button>
      <button role="menuitem" onClick={onOpenRepository}>
        <GitBranch className="mr-2 h-4 w-4" />
        Repository
        {hasLinkedRepo && (
          <span className="ml-auto text-[10px] text-primary">Linked</span>
        )}
      </button>
      {hasWorkingDirectory && legacyFolderAvailable && (
        <button role="menuitem" onClick={onOpenFolderInOS}>
          <ExternalLink className="mr-2 h-4 w-4" /> Open Folder
        </button>
      )}
      {onViewIssues && hasLinkedRepo && (
        <button role="menuitem" onClick={onViewIssues}>
          <CircleDot className="mr-2 h-4 w-4" /> View Issues
        </button>
      )}
      {onViewPRs && hasLinkedRepo && (
        <button role="menuitem" onClick={onViewPRs}>
          <GitPullRequest className="mr-2 h-4 w-4" /> View PRs
        </button>
      )}
      <button role="menuitem" onClick={onStartEdit}>
        <Pencil className="mr-2 h-4 w-4" /> Rename
      </button>
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

interface ProjectContextMenuProps extends ContentProps {
  children: ReactNode;
}

export function ProjectContextMenu({
  project,
  hasCustomPrefs,
  hasActiveSecrets,
  hasLinkedRepo,
  hasWorkingDirectory,
  legacyFolderAvailable,
  onNewTerminal,
  onNewAgent,
  onResume,
  onAdvanced,
  onNewWorktree,
  onOpenPreferences,
  onOpenSecrets,
  onOpenRepository,
  onOpenFolderInOS,
  onViewIssues,
  onViewPRs,
  onStartEdit,
  onDelete,
  children,
}: ProjectContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onNewTerminal}>
          <Terminal className="mr-2 h-4 w-4" /> New Terminal
        </ContextMenuItem>
        <ContextMenuItem onSelect={onNewAgent}>
          <Sparkles className="mr-2 h-4 w-4" /> New Agent
        </ContextMenuItem>
        <ContextMenuItem onSelect={onResume}>
          <History className="mr-2 h-4 w-4" /> Resume
        </ContextMenuItem>
        <ContextMenuItem onSelect={onAdvanced}>
          <Settings className="mr-2 h-4 w-4" /> Advanced…
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={onNewWorktree}
          disabled={!hasLinkedRepo}
          className={!hasLinkedRepo ? "opacity-50" : ""}
        >
          <GitBranch className="mr-2 h-4 w-4" /> New Worktree
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onOpenPreferences}>
          <Settings className="mr-2 h-4 w-4" />
          Preferences
          {hasCustomPrefs && (
            <span className="ml-auto text-[10px] text-primary">Custom</span>
          )}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onOpenSecrets}>
          <KeyRound className="mr-2 h-4 w-4" />
          Secrets
          {hasActiveSecrets && (
            <span className="ml-auto text-[10px] text-primary">Active</span>
          )}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onOpenRepository}>
          <GitBranch className="mr-2 h-4 w-4" />
          Repository
          {hasLinkedRepo && (
            <span className="ml-auto text-[10px] text-primary">Linked</span>
          )}
        </ContextMenuItem>
        {hasWorkingDirectory && legacyFolderAvailable && (
          <ContextMenuItem onSelect={onOpenFolderInOS}>
            <ExternalLink className="mr-2 h-4 w-4" /> Open Folder
          </ContextMenuItem>
        )}
        {onViewIssues && hasLinkedRepo && (
          <ContextMenuItem onSelect={onViewIssues}>
            <CircleDot className="mr-2 h-4 w-4" /> View Issues
          </ContextMenuItem>
        )}
        {onViewPRs && hasLinkedRepo && (
          <ContextMenuItem onSelect={onViewPRs}>
            <GitPullRequest className="mr-2 h-4 w-4" /> View PRs
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={onStartEdit}>
          <Pencil className="mr-2 h-4 w-4" /> Rename
        </ContextMenuItem>
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
