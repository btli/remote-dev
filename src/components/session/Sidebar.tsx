"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus, Terminal, Settings,
  Trash2, Sparkles, GitBranch,
  PanelLeftClose, PanelLeft,
  Fingerprint, Network,
  FolderPlus, Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";
import type { PinnedFile } from "@/types/pinned-files";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProfileContext } from "@/contexts/ProfileContext";
import { usePortContext } from "@/contexts/PortContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useSessionMCP, useSessionMCPAutoLoad } from "@/contexts/SessionMCPContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { MCPServersSection } from "@/components/mcp";
import { FilesSection } from "./FilesSection";
import {
  ProjectTreeSidebar,
  type ProjectTreeSidebarHandle,
} from "./ProjectTreeSidebar";
import { TrashButtonContextMenu } from "./TrashButtonContextMenu";
import { getSessionIconColor } from "./project-tree/sessionIconColor";
import { TerminalTypeClientRegistry } from "@/lib/terminal-plugins/client";
import {
  initializeClientPlugins,
  isClientPluginsInitialized,
} from "@/lib/terminal-plugins/init-client";

// Lazily initialize the client plugin registry so the collapsed-rail icon
// lookup below sees the built-in plugins. Mirrors the same idempotent guard
// used in SessionRow.tsx — safe during SSR, only mutates an in-memory Map.
if (!isClientPluginsInitialized()) {
  initializeClientPlugins();
}

// Sidebar width constraints
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 220;
const COLLAPSED_SIDEBAR_WIDTH = 48;

// Shared className for the footer action buttons (Profiles / Ports / Trash).
const FOOTER_BUTTON_CLASS = cn(
  "w-full flex items-center gap-1.5 px-2 py-1 rounded-md",
  "text-xs text-muted-foreground hover:text-foreground",
  "hover:bg-muted/50 transition-colors"
);

// Folder repo stats returned by getFolderRepoStats
export interface FolderRepoStats {
  prCount: number;
  issueCount: number;
  hasChanges: boolean;
}

interface SidebarProps {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  /**
   * Project id of the currently-active node (used by the header "New
   * Worktree" shortcut and the FilesSection).
   */
  activeProjectId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  /**
   * Predicates/stats on the currently-active project. The FilesSection /
   * FolderRepoStats types still use the legacy "folder" vocabulary; the
   * callbacks receive a project id.
   */
  projectHasRepo: (projectId: string) => boolean;
  getFolderRepoStats: (projectId: string) => FolderRepoStats | null;
  onSessionClick: (sessionId: string) => void;
  onSessionClose: (sessionId: string, options?: { deleteWorktree?: boolean }) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  onSessionTogglePin: (sessionId: string) => void;
  onSessionMove: (sessionId: string, projectId: string | null) => void;
  onSessionReorder: (sessionIds: string[]) => void;
  onNewSession: () => void;
  onQuickNewSession: () => void;
  onNewAgent: () => void;
  /**
   * Project-level handlers forwarded to ProjectTreeSidebar. Each receives
   * the project's `id`.
   */
  onProjectSettings: (projectId: string, projectName: string, initialTab?: "general" | "appearance" | "repository" | "environment") => void;
  onProjectNewSession: (projectId: string) => void;
  onProjectNewAgent: (projectId: string) => void;
  onProjectResumeClaudeSession: (projectId: string) => void;
  onProjectAdvancedSession: (projectId: string) => void;
  onProjectNewWorktree: (projectId: string) => void;
  /**
   * Open the per-project Secrets configuration as a terminal-type tab.
   * Supplies both the project id (used as the session's scope key) and
   * the current project name for the tab title.
   */
  onProjectOpenSecrets: (projectId: string, projectName: string) => void;
  trashCount: number;
  onTrashOpen: () => void;
  onSessionSchedule?: (sessionId: string) => void;
  onProfilesOpen?: () => void;
  onPortsOpen?: () => void;
  onViewIssues?: (folderId: string) => void;
  onViewPRs?: (folderId: string) => void;
  onViewMaintenance?: (folderId: string) => void;
  getFolderPinnedFiles?: (folderId: string) => PinnedFile[];
  onOpenPinnedFile?: (folderId: string, file: PinnedFile) => void;
  /**
   * Invoked when the user clicks the settings gear on a ProjectTree row
   * (group or project). Opens the GroupPreferencesModal for groups and
   * the `project-prefs` terminal-type session for projects. When omitted,
   * gear icons are hidden.
   */
  onOpenNodePreferences?: (node: {
    id: string;
    type: "group" | "project";
    name: string;
  }) => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  activeProjectId,
  collapsed,
  onCollapsedChange,
  width = DEFAULT_SIDEBAR_WIDTH,
  onWidthChange,
  projectHasRepo,
  getFolderRepoStats,
  onSessionClick,
  onSessionClose,
  onSessionRename,
  onSessionTogglePin,
  onSessionMove,
  onSessionReorder,
  onNewSession,
  onQuickNewSession,
  onNewAgent,
  onProjectSettings,
  onProjectNewSession,
  onProjectNewAgent,
  onProjectResumeClaudeSession,
  onProjectAdvancedSession,
  onProjectNewWorktree,
  onProjectOpenSecrets,
  trashCount,
  onTrashOpen,
  onSessionSchedule,
  onProfilesOpen,
  onPortsOpen,
  onViewIssues,
  onViewPRs,
  onViewMaintenance,
  getFolderPinnedFiles,
  onOpenPinnedFile,
  onOpenNodePreferences,
}: SidebarProps) {
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef<number>(0);
  const resizeStartWidthRef = useRef<number>(0);
  const projectTreeRef = useRef<ProjectTreeSidebarHandle | null>(null);
  // Queued "create at root" action fired from the collapsed-mode dropdown.
  // We can't call projectTreeRef directly while collapsed because
  // <ProjectTreeSidebar/> isn't mounted — stash the intent and fire it once
  // the tree remounts after expanding. Ref (not state) so the effect can
  // read-and-clear without triggering a cascading render.
  const pendingRootCreateRef = useRef<"group" | "project" | null>(null);
  useEffect(() => {
    if (collapsed) return;
    const pending = pendingRootCreateRef.current;
    if (!pending) return;
    const handle = projectTreeRef.current;
    if (!handle) return;
    pendingRootCreateRef.current = null;
    if (pending === "group") handle.startCreateGroupAtRoot();
    else handle.startCreateProjectAtRoot();
  }, [collapsed]);

  const handleNewGroup = useCallback(() => {
    if (collapsed) {
      pendingRootCreateRef.current = "group";
      onCollapsedChange(false);
    } else {
      projectTreeRef.current?.startCreateGroupAtRoot();
    }
  }, [collapsed, onCollapsedChange]);

  const handleNewProject = useCallback(() => {
    if (collapsed) {
      pendingRootCreateRef.current = "project";
      onCollapsedChange(false);
    } else {
      projectTreeRef.current?.startCreateProjectAtRoot();
    }
  }, [collapsed, onCollapsedChange]);

  const { profileCount } = useProfileContext();
  const { allocations, activePorts } = usePortContext();
  const { getNodePreferences } = usePreferencesContext();
  // Pulled from SessionContext (same source ProjectTreeSidebar uses) so the
  // collapsed rail can color agent icons by their real-time activity status.
  const { getAgentActivityStatus } = useSessionContext();

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartXRef.current;
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, resizeStartWidthRef.current + delta)
      );
      onWidthChange?.(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, onWidthChange]);

  // Find active session and check if it's an agent session
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const isAgentSession = activeSession?.terminalType === "agent";

  // MCP context for showing MCP servers when agent session is selected
  useSessionMCPAutoLoad(activeSessionId, isAgentSession);
  const { mcpSupported } = useSessionMCP();

  const activeSessions = sessions.filter((s) => s.status !== "closed");

  // Empty the trash permanently. Used by the right-click affordance on the
  // footer Trash button; see remote-dev-mtv7.7.
  //
  // Calls DELETE /api/trash — NOT POST (which only purges items whose TTL
  // already elapsed). See remote-dev-nmw4 for the regression this fixes.
  const handleEmptyTrashPermanently = useCallback(async () => {
    if (
      !window.confirm(
        "Permanently delete all trash items? This cannot be undone.",
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/trash", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = body?.error ? `: ${String(body.error)}` : "";
        console.error("Failed to empty trash" + detail);
        window.alert(`Failed to empty trash${detail}`);
      }
    } catch (err) {
      console.error("Failed to empty trash:", err);
      window.alert("Failed to empty trash");
    }
  }, []);

  // Opens the project's default working directory in the OS file manager.
  const handleOpenFolder = useCallback(
    async (projectId: string) => {
      const prefs = getNodePreferences("project", projectId);
      const cwd = prefs?.defaultWorkingDirectory;
      if (!cwd) {
        console.error("Failed to open folder: no working directory set for project", projectId);
        return;
      }
      try {
        const res = await fetch(`/api/projects/${projectId}/open`, { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          console.error("Failed to open folder:", data?.error || res.statusText);
        }
      } catch (err) {
        console.error("Failed to open folder:", err);
      }
    },
    [getNodePreferences],
  );


  return (
    <>
    <TooltipProvider delayDuration={200}>
    <div
      className={cn(
        "h-full flex flex-col bg-card/50 backdrop-blur-md border-r border-border",
        "transition-[width] duration-200 relative shrink-0",
        "pl-safe-left",
        isResizing && "select-none"
      )}
      style={{ width: collapsed ? COLLAPSED_SIDEBAR_WIDTH : width }}
    >
        {/* Resize handle */}
        {!collapsed && (
          <div
            className={cn(
              "absolute top-0 right-0 w-1 h-full cursor-ew-resize z-10",
              "hover:bg-primary/50 transition-colors",
              isResizing && "bg-primary/50"
            )}
            onMouseDown={handleResizeStart}
          />
        )}
        {/* Header */}
        <div className={cn(
          "flex items-center border-b border-border shrink-0",
          collapsed ? "justify-center px-1 py-1" : "justify-between px-3 h-10"
        )}>
          {collapsed ? (
            // Collapsed header - expand toggle + create dropdown so the rail
            // exposes the same actions as the expanded header. Without the
            // dropdown the rail is functionally empty when sessions exist
            // (see remote-dev-t9f3).
            <div className="flex flex-col items-center gap-1 py-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => onCollapsedChange(false)}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Expand sidebar"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    <PanelLeft className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Expand sidebar</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Create"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right">Create</TooltipContent>
                </Tooltip>
                <DropdownMenuContent side="right" align="start" className="w-44">
                  <DropdownMenuItem onClick={handleNewGroup}>
                    <FolderPlus className="w-3.5 h-3.5 mr-2" />
                    New Group
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleNewProject}>
                    <Briefcase className="w-3.5 h-3.5 mr-2" />
                    New Project
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onQuickNewSession}>
                    <Terminal className="w-3.5 h-3.5 mr-2" />
                    New Terminal
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onNewAgent}>
                    <Sparkles className="w-3.5 h-3.5 mr-2" />
                    New Agent
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      if (activeProjectId && projectHasRepo(activeProjectId)) {
                        onProjectNewWorktree(activeProjectId);
                      }
                    }}
                    disabled={!activeProjectId || !projectHasRepo(activeProjectId)}
                  >
                    <GitBranch className="w-3.5 h-3.5 mr-2" />
                    New Worktree
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onNewSession}>
                    <Settings className="w-3.5 h-3.5 mr-2" />
                    Advanced...
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            // Expanded header
            <>
              <div className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-medium text-foreground">Sessions</span>
              </div>
              <div className="flex items-center gap-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={handleNewGroup}>
                      <FolderPlus className="w-3.5 h-3.5 mr-2" />
                      New Group
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleNewProject}>
                      <Briefcase className="w-3.5 h-3.5 mr-2" />
                      New Project
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onQuickNewSession}>
                      <Terminal className="w-3.5 h-3.5 mr-2" />
                      New Terminal
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onNewAgent}>
                      <Sparkles className="w-3.5 h-3.5 mr-2" />
                      New Agent
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        if (activeProjectId && projectHasRepo(activeProjectId)) {
                          onProjectNewWorktree(activeProjectId);
                        }
                      }}
                      disabled={!activeProjectId || !projectHasRepo(activeProjectId)}
                    >
                      <GitBranch className="w-3.5 h-3.5 mr-2" />
                      New Worktree
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onNewSession}>
                      <Settings className="w-3.5 h-3.5 mr-2" />
                      Advanced...
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  onClick={() => onCollapsedChange(true)}
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <PanelLeftClose className="w-3.5 h-3.5" />
                </Button>
              </div>
            </>
          )}
        </div>

      {/* Session List */}
      <div
          className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5"
        >
          {collapsed ? (
            // Collapsed body — vertical icon rail. Each session becomes an
            // icon-only button (with tooltip + active-state styling) so the
            // rail is functionally usable when sessions exist (remote-dev-t9f3).
            // GLOBAL_TERMINAL_TYPES (settings/recordings/profiles) appear
            // inline since they're just sessions with their own plugin icon.
            activeSessions.length === 0 ? (
              <div className="flex justify-center pt-2 text-[10px] text-muted-foreground/60">
                {/* Header dropdown already provides the create affordance,
                    so an empty rail intentionally renders nothing. */}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-0.5">
                {activeSessions.map((s) => {
                  const plugin = TerminalTypeClientRegistry.get(s.terminalType);
                  // Always use the plugin icon — the rail is purpose-built to
                  // surface the session type. Worktree state is reflected via
                  // the icon color helper below (and in the expanded row's
                  // metadata bar), not by replacing the icon. Without this
                  // an agent session living in a worktree would render as
                  // GitBranch and lose its agent-type signal entirely.
                  const Icon = plugin?.icon ?? Terminal;
                  const derivedTitle = plugin?.deriveTitle?.(s) ?? null;
                  const displayTitle = derivedTitle ?? s.name;
                  const isActive = s.id === activeSessionId;
                  // Reuse the same color helper SessionRow uses so agent
                  // sessions get running/waiting/error/compacting affordances
                  // in the rail too. Returns "text-{color}" plus optional
                  // animation classes (e.g. "agent-breathing").
                  const iconColor = getSessionIconColor(
                    s,
                    isActive,
                    getAgentActivityStatus
                  );
                  return (
                    <Tooltip key={s.id}>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => onSessionClick(s.id)}
                          variant="ghost"
                          size="icon-sm"
                          aria-label={displayTitle}
                          aria-current={isActive ? "true" : undefined}
                          className={cn(
                            "h-7 w-7 transition-colors",
                            isActive
                              ? "bg-accent"
                              : "hover:bg-accent"
                          )}
                        >
                          <Icon className={cn("w-3.5 h-3.5", iconColor)} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">{displayTitle}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            )
          ) : activeSessions.length === 0 ? (
            <div className="text-center py-8 px-2">
              <Terminal className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground mb-2">No sessions</p>
              <div className="flex flex-col gap-1 items-center">
                <Button
                  onClick={onQuickNewSession}
                  variant="ghost"
                  size="sm"
                  className="text-xs text-primary hover:text-primary/80 hover:bg-primary/10"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  New Session
                </Button>
                <button
                  onClick={onNewSession}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Advanced options...
                </button>
              </div>
            </div>
          ) : (
            // Project tree (groups + projects). Replaces the legacy folder
            // tree rendering path as of Phase G1.
            <ProjectTreeSidebar
              ref={projectTreeRef}
              getProjectRepoStats={getFolderRepoStats}
              onOpenPreferences={onOpenNodePreferences}
              onSessionClick={onSessionClick}
              onSessionClose={(sid) => onSessionClose(sid)}
              onSessionStartEdit={() => {}}
              onSessionRename={onSessionRename}
              onProjectNewSession={onProjectNewSession}
              onProjectNewAgent={onProjectNewAgent}
              onProjectResumeClaudeSession={onProjectResumeClaudeSession}
              onProjectAdvancedSession={onProjectAdvancedSession}
              onProjectNewWorktree={onProjectNewWorktree}
              onProjectOpenSecrets={onProjectOpenSecrets}
              onProjectOpenRepository={(fid, name) =>
                onProjectSettings(fid, name, "repository")
              }
              onProjectOpenFolderInOS={handleOpenFolder}
              onProjectViewIssues={onViewIssues}
              onProjectViewPRs={onViewPRs}
              onProjectViewMaintenance={onViewMaintenance}
              onSessionTogglePin={onSessionTogglePin}
              onSessionMove={onSessionMove}
              onSessionReorder={onSessionReorder}
              onSessionSchedule={onSessionSchedule}
            />
          )}
      </div>

      {/* Files Section - default + pinned files for active folder */}
      {getFolderPinnedFiles && onOpenPinnedFile && (
        <FilesSection
          activeFolderId={activeProjectId}
          collapsed={collapsed}
          getFolderPinnedFiles={getFolderPinnedFiles}
          onOpenFile={onOpenPinnedFile}
          activeSessionId={activeSessionId}
        />
      )}

      {/* MCP Servers Section - only show when agent session is selected */}
      {isAgentSession && mcpSupported && (
        <MCPServersSection collapsed={collapsed} />
      )}

      {/* Footer - collapsed icon rail */}
      {collapsed && (onProfilesOpen || onPortsOpen || trashCount > 0) && (
        <div className="px-1 py-1.5 border-t border-border flex flex-col items-center gap-1">
          {onProfilesOpen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onProfilesOpen}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Profiles"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <Fingerprint className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Profiles{profileCount > 0 ? ` (${profileCount})` : ""}
              </TooltipContent>
            </Tooltip>
          )}
          {onPortsOpen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onPortsOpen}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Ports"
                  className={cn(
                    "h-7 w-7 hover:bg-accent",
                    activePorts.size > 0
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Network className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Ports
                {allocations.length > 0
                  ? ` (${activePorts.size > 0 ? `${activePorts.size}/${allocations.length}` : allocations.length})`
                  : ""}
              </TooltipContent>
            </Tooltip>
          )}
          {trashCount > 0 && (
            <Tooltip>
              <TrashButtonContextMenu
                onEmptyPermanently={handleEmptyTrashPermanently}
              >
                <TooltipTrigger asChild>
                  <Button
                    onClick={onTrashOpen}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Trash"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
              </TrashButtonContextMenu>
              <TooltipContent side="right">
                Trash ({trashCount})
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Footer - hide when collapsed */}
      {!collapsed && (
        <div className="px-1 py-1.5 border-t border-border space-y-0.5">
          {/* Profiles button */}
          {onProfilesOpen && (
            <button
              onClick={onProfilesOpen}
              className={FOOTER_BUTTON_CLASS}
            >
              <Fingerprint className="w-3.5 h-3.5 shrink-0" />
              <span>Profiles</span>
              {profileCount > 0 && (
                <span className="ml-auto text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {profileCount}
                </span>
              )}
            </button>
          )}
          {/* Ports button */}
          {onPortsOpen && (
            <button
              onClick={onPortsOpen}
              className={FOOTER_BUTTON_CLASS}
            >
              <Network className="w-3.5 h-3.5 shrink-0" />
              <span>Ports</span>
              {allocations.length > 0 && (
                <span className={cn(
                  "ml-auto text-[10px] px-1.5 py-0.5 rounded",
                  activePorts.size > 0
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground bg-muted"
                )}>
                  {activePorts.size > 0 ? `${activePorts.size}/${allocations.length}` : allocations.length}
                </span>
              )}
            </button>
          )}
          {/* Trash button - only show when there are items. Right-click opens
              an "Empty Permanently" affordance (see remote-dev-mtv7.7). */}
          {trashCount > 0 && (
            <TrashButtonContextMenu
              onEmptyPermanently={handleEmptyTrashPermanently}
            >
              <button
                onClick={onTrashOpen}
                className={FOOTER_BUTTON_CLASS}
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Trash</span>
                <span className="ml-auto text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {trashCount}
                </span>
              </button>
            </TrashButtonContextMenu>
          )}
          <div className="flex items-center justify-between px-2 pt-1 text-[10px] text-muted-foreground">
            <span>New session</span>
            <kbd className="px-1 py-0.5 bg-muted rounded">⌘↵</kbd>
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
    </>
  );
}
