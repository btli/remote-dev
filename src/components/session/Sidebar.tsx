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
import { MCPServersSection } from "@/components/mcp";
import { FilesSection } from "./FilesSection";
import {
  ProjectTreeSidebar,
  type ProjectTreeSidebarHandle,
} from "./ProjectTreeSidebar";
import { TrashButtonContextMenu } from "./TrashButtonContextMenu";

// Sidebar width constraints
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 220;
const COLLAPSED_SIDEBAR_WIDTH = 48;

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
          "flex items-center border-b border-border h-10 shrink-0",
          collapsed ? "justify-center px-1" : "justify-between px-3"
        )}>
          {collapsed ? (
            // Collapsed header - just toggle button
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => onCollapsedChange(false)}
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <PanelLeft className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
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
          {activeSessions.length === 0 ? (
            collapsed ? (
              // Collapsed empty state - dropdown mirroring the expanded header
              <div className="flex flex-col items-center py-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                      aria-label="Create"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onNewSession}>
                      <Settings className="w-3.5 h-3.5 mr-2" />
                      Advanced...
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
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
            )
          ) : (
            <>
              {/* Project tree (groups + projects). Replaces the legacy folder
                  tree rendering path as of Phase G1. */}
              {!collapsed && (
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
            </>
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

      {/* Footer - hide when collapsed */}
      {!collapsed && (
        <div className="px-3 py-1.5 border-t border-border space-y-1">
          {/* Profiles button */}
          {onProfilesOpen && (
            <button
              onClick={onProfilesOpen}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md",
                "text-xs text-muted-foreground hover:text-foreground",
                "hover:bg-muted/50 transition-colors"
              )}
            >
              <Fingerprint className="w-3.5 h-3.5" />
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
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md",
                "text-xs text-muted-foreground hover:text-foreground",
                "hover:bg-muted/50 transition-colors"
              )}
            >
              <Network className="w-3.5 h-3.5" />
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
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md",
                  "text-xs text-muted-foreground hover:text-foreground",
                  "hover:bg-muted/50 transition-colors"
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Trash</span>
                <span className="ml-auto text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {trashCount}
                </span>
              </button>
            </TrashButtonContextMenu>
          )}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
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
