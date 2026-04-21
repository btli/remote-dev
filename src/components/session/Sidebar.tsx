"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus, Terminal, Settings,
  Trash2, Sparkles, GitBranch,
  PanelLeftClose, PanelLeft,
  Fingerprint, Network,
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
import { SecretsConfigModal } from "@/components/secrets/SecretsConfigModal";
import { useProfileContext } from "@/contexts/ProfileContext";
import { usePortContext } from "@/contexts/PortContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useSessionMCP, useSessionMCPAutoLoad } from "@/contexts/SessionMCPContext";
import { MCPServersSection } from "@/components/mcp";
import { FilesSection } from "./FilesSection";
import { ProjectTreeSidebar } from "./ProjectTreeSidebar";

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
   * Legacy folder id of the currently-active project (used by the header
   * "New Worktree" shortcut and the FilesSection). Renaming to
   * `activeProjectFolderId` is deferred to the Phase G3 type cleanup.
   */
  activeFolderId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  /**
   * Predicates/stats still keyed by legacy folder id for back-compat with
   * SessionManager's existing prop API. ProjectTreeSidebar itself is now
   * node-keyed; these props are only consumed by the "New Worktree" header
   * shortcut and the FilesSection below.
   */
  folderHasRepo: (folderId: string) => boolean;
  getFolderRepoStats: (folderId: string) => FolderRepoStats | null;
  onSessionClick: (sessionId: string) => void;
  onSessionClose: (sessionId: string, options?: { deleteWorktree?: boolean }) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  onSessionTogglePin: (sessionId: string) => void;
  onSessionMove: (sessionId: string, folderId: string | null) => void;
  onSessionReorder: (sessionIds: string[]) => void;
  onNewSession: () => void;
  onQuickNewSession: () => void;
  onNewAgent: () => void;
  /**
   * Project-level handlers forwarded to ProjectTreeSidebar. Each receives
   * the project's `id` (the folderId prop name is retained for now —
   * see commit rename in remote-dev-w1ed stage 2).
   */
  onProjectSettings: (folderId: string, folderName: string, initialTab?: "general" | "appearance" | "repository" | "environment") => void;
  onProjectNewSession: (folderId: string) => void;
  onProjectNewAgent: (folderId: string) => void;
  onProjectResumeClaudeSession: (folderId: string) => void;
  onProjectAdvancedSession: (folderId: string) => void;
  onProjectNewWorktree: (folderId: string) => void;
  trashCount: number;
  onTrashOpen: () => void;
  onSessionSchedule?: (sessionId: string) => void;
  onProfilesOpen?: () => void;
  onPortsOpen?: () => void;
  onViewIssues?: (folderId: string) => void;
  onViewPRs?: (folderId: string) => void;
  getFolderPinnedFiles?: (folderId: string) => PinnedFile[];
  onOpenPinnedFile?: (folderId: string, file: PinnedFile) => void;
  /**
   * Invoked when the user clicks the settings gear on a ProjectTree row
   * (group or project). Opens the corresponding
   * Group/ProjectPreferencesModal. When omitted, gear icons are hidden.
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
  activeFolderId,
  collapsed,
  onCollapsedChange,
  width = DEFAULT_SIDEBAR_WIDTH,
  onWidthChange,
  folderHasRepo,
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
  trashCount,
  onTrashOpen,
  onSessionSchedule,
  onProfilesOpen,
  onPortsOpen,
  onViewIssues,
  onViewPRs,
  getFolderPinnedFiles,
  onOpenPinnedFile,
  onOpenNodePreferences,
}: SidebarProps) {
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef<number>(0);
  const resizeStartWidthRef = useRef<number>(0);

  // Secrets modal state. `secretsModalProjectId` holds the target project's
  // id (SecretsConfigModal's internal prop is still named `initialFolderId`
  // for historical reasons; a rename is deferred to Stage 2).
  const [secretsModalOpen, setSecretsModalOpen] = useState(false);
  const [secretsModalProjectId, setSecretsModalProjectId] = useState<string | null>(null);
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
                        if (activeFolderId && folderHasRepo(activeFolderId)) {
                          onProjectNewWorktree(activeFolderId);
                        }
                      }}
                      disabled={!activeFolderId || !folderHasRepo(activeFolderId)}
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
              // Collapsed empty state - just show plus button
              <div className="flex flex-col items-center py-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={onQuickNewSession}
                      variant="ghost"
                      size="icon-sm"
                      className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">New session</TooltipContent>
                </Tooltip>
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
                  onProjectOpenSecrets={(projectId) => {
                    setSecretsModalProjectId(projectId);
                    setSecretsModalOpen(true);
                  }}
                  onProjectOpenRepository={(fid, name) =>
                    onProjectSettings(fid, name, "repository")
                  }
                  onProjectOpenFolderInOS={handleOpenFolder}
                  onProjectViewIssues={onViewIssues}
                  onProjectViewPRs={onViewPRs}
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
          activeFolderId={activeFolderId}
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
          {/* Trash button - only show when there are items */}
          {trashCount > 0 && (
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
          )}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>New session</span>
            <kbd className="px-1 py-0.5 bg-muted rounded">⌘↵</kbd>
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>

      {/* Secrets configuration modal. `initialFolderId` is a legacy prop
          name on the modal itself — the value we pass is the project's id,
          which is what the backend secrets tables key on. */}
      <SecretsConfigModal
        open={secretsModalOpen}
        onClose={() => {
          setSecretsModalOpen(false);
          setSecretsModalProjectId(null);
        }}
        initialFolderId={secretsModalProjectId}
      />
    </>
  );
}
