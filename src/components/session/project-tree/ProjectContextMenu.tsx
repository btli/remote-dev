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
  Terminal,
  Sparkles,
  Server,
  History,
  Settings,
  GitBranch,
  KeyRound,
  ExternalLink,
  CircleDot,
  GitPullRequest,
  Wrench,
  Pencil,
  Trash2,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
} from "lucide-react";
import type { ProjectNode } from "@/contexts/ProjectTreeContext";
import { ContextNewSshSubmenu } from "../NewSshSubmenu";
import { ContextNewAgentSubmenu } from "../NewAgentSubmenu";
import type { AgentProviderType } from "@/types/session";

interface GroupOption {
  id: string;
  name: string;
}

interface ContentProps {
  project: ProjectNode;
  hasCustomPrefs: boolean;
  hasActiveSecrets: boolean;
  hasLinkedRepo: boolean;
  hasWorkingDirectory: boolean;
  /** All groups in the tree, offered as move targets. */
  moveTargetGroups?: GroupOption[];
  onNewTerminal: () => void;
  onNewAgent: () => void;
  /** Create a new agent session under this project with an explicit provider. */
  onNewAgentWithProvider: (provider: AgentProviderType) => void;
  /** Open Settings → Agents from the project context menu. */
  onOpenAgentSettings: () => void;
  /** Create a new SSH session under this project for the chosen connection. */
  onNewSshSession: (connectionId: string) => void;
  /** Open Settings → SSH so the user can manage saved connections. */
  onOpenSshSettings: () => void;
  onResume: () => void;
  onAdvanced: () => void;
  onNewWorktree: () => void;
  /**
   * Optional. When omitted, the Preferences item is not rendered.
   * See remote-dev-mtv7.5.
   */
  onOpenPreferences?: () => void;
  onOpenSecrets: () => void;
  onOpenRepository: () => void;
  onOpenFolderInOS: () => void;
  onViewIssues?: () => void;
  onViewPRs?: () => void;
  onViewMaintenance?: () => void;
  onStartEdit: () => void;
  onToggleCollapse?: () => void;
  /** Move this project under a new group. `null` targets the root. */
  onMoveToGroup?: (newGroupId: string | null) => void;
  /**
   * Optional. Opens the migrate-to-instance dialog (server-to-server
   * migration). When omitted, the item is not rendered.
   */
  onMigrate?: () => void;
  onDelete: () => void;
}

/**
 * Exported for direct testing without requiring Radix menu context.
 * Renders plain buttons so the content can be unit-tested in isolation.
 */
export function ProjectContextMenuContent({
  project,
  hasCustomPrefs,
  hasActiveSecrets,
  hasLinkedRepo,
  hasWorkingDirectory,
  moveTargetGroups,
  onNewTerminal,
  onNewAgent,
  onNewAgentWithProvider,
  onOpenAgentSettings,
  onNewSshSession,
  onOpenSshSettings,
  onResume,
  onAdvanced,
  onNewWorktree,
  onOpenPreferences,
  onOpenSecrets,
  onOpenRepository,
  onOpenFolderInOS,
  onViewIssues,
  onViewPRs,
  onViewMaintenance,
  onStartEdit,
  onToggleCollapse,
  onMoveToGroup,
  onMigrate,
  onDelete,
}: ContentProps) {
  // Plain-button variant: we don't render a hover-expanded submenu of saved
  // connections (no Radix sub-menu primitive available), so we expose two
  // flat affordances tagged with `data-testid` so unit tests can target
  // them directly.
  return (
    <div role="menu">
      <button role="menuitem" onClick={onNewTerminal}>
        <Terminal className="mr-2 h-4 w-4" /> New Terminal
      </button>
      <button role="menuitem" onClick={onNewAgent}>
        <Sparkles className="mr-2 h-4 w-4" /> New Agent
      </button>
      <button
        role="menuitem"
        data-testid="project-new-agent-claude"
        onClick={() => onNewAgentWithProvider("claude")}
      >
        <Sparkles className="mr-2 h-4 w-4" /> Pick Agent
      </button>
      <button
        role="menuitem"
        data-testid="project-configure-agents"
        onClick={onOpenAgentSettings}
      >
        <Sparkles className="mr-2 h-4 w-4" /> Configure agents…
      </button>
      <button
        role="menuitem"
        data-testid="project-new-ssh"
        onClick={() => onNewSshSession("")}
      >
        <Server className="mr-2 h-4 w-4" /> New SSH
      </button>
      <button
        role="menuitem"
        data-testid="project-manage-ssh"
        onClick={onOpenSshSettings}
      >
        <Server className="mr-2 h-4 w-4" /> Manage SSH Connections…
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
      {onOpenPreferences && (
        <button role="menuitem" onClick={onOpenPreferences}>
          <Settings className="mr-2 h-4 w-4" />
          Preferences
          {hasCustomPrefs && (
            <span className="ml-auto text-[10px] text-primary">Custom</span>
          )}
        </button>
      )}
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
      {hasWorkingDirectory && (
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
      {onViewMaintenance && hasLinkedRepo && (
        <button role="menuitem" onClick={onViewMaintenance}>
          <Wrench className="mr-2 h-4 w-4" /> Maintenance
        </button>
      )}
      <button role="menuitem" onClick={onStartEdit}>
        <Pencil className="mr-2 h-4 w-4" /> Rename
      </button>
      {onToggleCollapse && (
        <button role="menuitem" onClick={onToggleCollapse}>
          {project.collapsed ? (
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
            disabled={project.groupId === null}
            onClick={() => {
              if (project.groupId !== null) onMoveToGroup(null);
            }}
          >
            <FolderOpen className="mr-2 h-4 w-4" /> Root (top level)
          </button>
          {(moveTargetGroups ?? []).map((g) => (
            <button
              key={g.id}
              role="menuitem"
              disabled={project.groupId === g.id}
              onClick={() => {
                if (project.groupId !== g.id) onMoveToGroup(g.id);
              }}
            >
              <Folder className="mr-2 h-4 w-4" /> {g.name}
            </button>
          ))}
        </div>
      )}
      {onMigrate && (
        <button
          role="menuitem"
          data-testid="project-migrate"
          onClick={onMigrate}
        >
          <ArrowRightLeft className="mr-2 h-4 w-4" /> Migrate to instance…
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

interface ProjectContextMenuProps extends ContentProps {
  children: ReactNode;
}

export function ProjectContextMenu({
  project,
  hasCustomPrefs,
  hasActiveSecrets,
  hasLinkedRepo,
  hasWorkingDirectory,
  moveTargetGroups,
  onNewTerminal,
  onNewAgent,
  onNewAgentWithProvider,
  onOpenAgentSettings,
  onNewSshSession,
  onOpenSshSettings,
  onResume,
  onAdvanced,
  onNewWorktree,
  onOpenPreferences,
  onOpenSecrets,
  onOpenRepository,
  onOpenFolderInOS,
  onViewIssues,
  onViewPRs,
  onViewMaintenance,
  onStartEdit,
  onToggleCollapse,
  onMoveToGroup,
  onMigrate,
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
        <ContextNewAgentSubmenu
          onSelect={onNewAgentWithProvider}
          onManage={onOpenAgentSettings}
        />
        <ContextNewSshSubmenu
          onSelect={onNewSshSession}
          onManage={onOpenSshSettings}
        />
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
        {onOpenPreferences && (
          <ContextMenuItem onSelect={onOpenPreferences}>
            <Settings className="mr-2 h-4 w-4" />
            Preferences
            {hasCustomPrefs && (
              <span className="ml-auto text-[10px] text-primary">Custom</span>
            )}
          </ContextMenuItem>
        )}
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
        {hasWorkingDirectory && (
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
        {onViewMaintenance && hasLinkedRepo && (
          <ContextMenuItem onSelect={onViewMaintenance}>
            <Wrench className="mr-2 h-4 w-4" /> Maintenance
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={onStartEdit}>
          <Pencil className="mr-2 h-4 w-4" /> Rename
        </ContextMenuItem>
        {onToggleCollapse && (
          <ContextMenuItem onSelect={onToggleCollapse}>
            {project.collapsed ? (
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
                disabled={project.groupId === null}
              >
                <FolderOpen className="mr-2 h-4 w-4" /> Root (top level)
              </ContextMenuItem>
              {(moveTargetGroups ?? []).map((g) => (
                <ContextMenuItem
                  key={g.id}
                  onSelect={() => onMoveToGroup(g.id)}
                  disabled={project.groupId === g.id}
                >
                  <Folder className="mr-2 h-4 w-4" /> {g.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {onMigrate && (
          <ContextMenuItem onSelect={onMigrate}>
            <ArrowRightLeft className="mr-2 h-4 w-4" /> Migrate to instance…
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
