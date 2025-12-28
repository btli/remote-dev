"use client";

import { useState, useCallback, useEffect, useRef, useMemo, useSyncExternalStore, Activity, useEffectEvent } from "react";
import { Sidebar } from "./Sidebar";
import { NewSessionWizard } from "./NewSessionWizard";
import { SaveTemplateModal } from "./SaveTemplateModal";
import { FolderPreferencesModal } from "@/components/preferences/FolderPreferencesModal";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsPanel } from "@/components/KeyboardShortcutsPanel";
import { RecordingsModal } from "@/components/session/RecordingsModal";
import { SaveRecordingModal } from "@/components/session/SaveRecordingModal";
import { TrashModal } from "@/components/trash/TrashModal";
import { CreateScheduleModal, SchedulesModal } from "@/components/schedule";
import { ProfilesModal } from "@/components/profiles/ProfilesModal";
import { PortManagerModal } from "@/components/ports/PortManagerModal";
import { useSessionContext } from "@/contexts/SessionContext";
import { useRecordingContext } from "@/contexts/RecordingContext";
import { useRecording } from "@/hooks/useRecording";
import { useFolderContext } from "@/contexts/FolderContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useSplitContext } from "@/contexts/SplitContext";
import { useTrashContext } from "@/contexts/TrashContext";
import { useGitHubStats } from "@/contexts/GitHubStatsContext";
import { useSecretsContext } from "@/contexts/SecretsContext";
import {
  getEnvironmentWithSecretsSync,
  prefetchSecretsForFolder,
} from "@/hooks/useEnvironmentWithSecrets";
import type { FolderRepoStats } from "./Sidebar";
import { Terminal as TerminalIcon, Plus, Columns, Rows, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import { SplitPaneLayout } from "@/components/split/SplitPaneLayout";

import type { TerminalWithKeyboardRef } from "@/components/terminal/TerminalWithKeyboard";

// Dynamically import TerminalWithKeyboard to avoid SSR issues with xterm
const TerminalWithKeyboard = dynamic(
  () =>
    import("@/components/terminal/TerminalWithKeyboard").then(
      (mod) => mod.TerminalWithKeyboard
    ),
  { ssr: false }
);

// Stable subscription functions for useSyncExternalStore (must be outside component)
// These listen for both cross-tab storage events and same-tab custom events
function subscribeToSidebarCollapsed(callback: () => void) {
  const handler = (e: Event) => {
    if (e instanceof StorageEvent && e.key !== "sidebar-collapsed") return;
    callback();
  };
  window.addEventListener("storage", handler);
  window.addEventListener("sidebar-collapsed-change", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("sidebar-collapsed-change", handler);
  };
}

function subscribeToSidebarWidth(callback: () => void) {
  const handler = (e: Event) => {
    if (e instanceof StorageEvent && e.key !== "sidebar-width") return;
    callback();
  };
  window.addEventListener("storage", handler);
  window.addEventListener("sidebar-width-change", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("sidebar-width-change", handler);
  };
}

function getSidebarCollapsed() {
  return localStorage.getItem("sidebar-collapsed") === "true";
}

function getSidebarWidth() {
  const saved = localStorage.getItem("sidebar-width");
  if (saved) {
    const width = parseInt(saved, 10);
    if (!isNaN(width) && width >= 180 && width <= 400) return width;
  }
  return 220;
}

// SSR snapshots (return defaults for hydration)
function getServerSidebarCollapsed() {
  return false;
}

function getServerSidebarWidth() {
  return 220;
}

interface SessionManagerProps {
  isGitHubConnected?: boolean;
}

export function SessionManager({ isGitHubConnected = false }: SessionManagerProps) {
  const {
    sessions,
    activeSessionId,
    loading,
    createSession,
    closeSession,
    suspendSession,
    resumeSession,
    updateSession,
    setActiveSession,
    reorderSessions,
    refreshSessions,
  } = useSessionContext();

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardFolderId, setWizardFolderId] = useState<string | null>(null);
  const [sessionCounter, setSessionCounter] = useState(1);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Use useSyncExternalStore for localStorage values to avoid hydration mismatches
  // and prevent cascading renders from setState in effects.
  // Functions are defined outside the component for stable identity.
  const sidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarCollapsed,
    getSidebarCollapsed,
    getServerSidebarCollapsed
  );

  const sidebarWidth = useSyncExternalStore(
    subscribeToSidebarWidth,
    getSidebarWidth,
    getServerSidebarWidth
  );

  // Helper to update localStorage and trigger re-render
  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
    window.dispatchEvent(new CustomEvent("sidebar-collapsed-change"));
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    localStorage.setItem("sidebar-width", String(width));
    window.dispatchEvent(new CustomEvent("sidebar-width-change"));
  }, []);

  // Track mobile state for responsive sidebar behavior
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const [folderSettingsModal, setFolderSettingsModal] = useState<{
    folderId: string;
    folderName: string;
    initialTab?: "general" | "appearance" | "repository" | "environment";
  } | null>(null);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
  const [isRecordingsModalOpen, setIsRecordingsModalOpen] = useState(false);
  const [isSaveRecordingModalOpen, setIsSaveRecordingModalOpen] = useState(false);
  const [mobileEditingName, setMobileEditingName] = useState<string | null>(null);

  // Recording state
  const { createRecording } = useRecordingContext();
  const {
    isRecording,
    duration: recordingDuration,
    startRecording,
    stopRecording,
    recordOutput,
    updateDimensions,
  } = useRecording({
    sessionId: activeSessionId || undefined,
    onSave: async (data) => {
      await createRecording(data);
    },
  });

  // Terminal refs for focus management
  const terminalRefsMap = useRef<Map<string, TerminalWithKeyboardRef>>(new Map());

  // Compute WebSocket URL based on current location (supports cloudflared tunnels)
  const wsUrl = useMemo(() => {
    if (typeof window === "undefined") return "ws://localhost:3001";
    const { protocol, hostname, port } = window.location;
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    if (isLocalhost) {
      // Local development: use terminal server port directly
      return `ws://localhost:${process.env.NEXT_PUBLIC_TERMINAL_PORT || "3001"}`;
    }
    // Remote access via tunnel: use /ws path (cloudflared routes to terminal server)
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${hostname}${port ? `:${port}` : ""}/ws`;
  }, []);

  // Note: No longer need refs for keyboard handler - useEffectEvent handles this

  // setSidebarCollapsed and setSidebarWidth already persist to localStorage
  // and trigger re-renders via useSyncExternalStore

  // Folder state from context (persisted in database)
  const {
    folders,
    createFolder,
    updateFolder,
    deleteFolder,
    toggleFolder,
    moveSessionToFolder,
    moveFolderToParent,
    reorderFolders,
    registerSessionFolder,
  } = useFolderContext();

  // Trash state from context
  const { count: trashCount, trashSession, getTrashForFolder, deleteItem: deleteTrashItem } = useTrashContext();
  const [isTrashOpen, setIsTrashOpen] = useState(false);

  // Schedule modal state
  const [isCreateScheduleOpen, setIsCreateScheduleOpen] = useState(false);
  const [scheduleTargetSession, setScheduleTargetSession] = useState<typeof activeSessions[0] | null>(null);
  const [isSchedulesOpen, setIsSchedulesOpen] = useState(false);
  const [schedulesFilterSession, setSchedulesFilterSession] = useState<{ id: string; name: string } | null>(null);

  // Profiles modal state
  const [isProfilesModalOpen, setIsProfilesModalOpen] = useState(false);

  // Port manager modal state
  const [isPortsModalOpen, setIsPortsModalOpen] = useState(false);

  // Get trash count for a specific folder
  const getFolderTrashCount = useCallback(
    (folderId: string) => getTrashForFolder(folderId).length,
    [getTrashForFolder]
  );

  // Empty all trash items in a specific folder
  const handleEmptyTrash = useCallback(
    async (folderId: string) => {
      const trashItems = getTrashForFolder(folderId);
      if (trashItems.length === 0) return;

      // Delete all trash items for this folder
      const results = await Promise.allSettled(
        trashItems.map((item) => deleteTrashItem(item.id))
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.error("Some trash items failed to delete:", failures);
      }
    },
    [getTrashForFolder, deleteTrashItem]
  );

  // Preferences state from context
  const {
    userSettings,
    activeProject,
    hasFolderPreferences,
    folderHasRepo,
    currentPreferences,
    setActiveFolder,
    resolvePreferencesForFolder,
    getEnvironmentForFolder,
  } = usePreferencesContext();

  // Secrets state from context
  const { fetchSecretsForFolder, configuredFolderIds } = useSecretsContext();

  // GitHub stats for repo badges on folders
  const { getRepositoryById } = useGitHubStats();

  // Split state from context
  const {
    getSplitForSession,
    createSplit,
    removeFromSplit,
    updateLayout,
    dissolveSplit,
  } = useSplitContext();

  // Split pane state - derived from context
  const activeSplit = activeSessionId ? getSplitForSession(activeSessionId) : null;
  const isSplitMode = activeSplit !== null && activeSplit.sessions.length > 1;

  // Focus terminal when active session changes
  useEffect(() => {
    if (activeSessionId && !isSplitMode) {
      // Small delay to ensure terminal is mounted and visible
      const timeoutId = setTimeout(() => {
        terminalRefsMap.current.get(activeSessionId)?.focus();
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [activeSessionId, isSplitMode]);

  const activeSessions = sessions.filter((s) => s.status !== "closed");

  // Pre-fetch secrets for active session folders that have secrets configured
  useEffect(() => {
    const foldersWithSecrets = new Set<string>();

    // Find unique folderIds from active sessions that have secrets configured
    for (const session of activeSessions) {
      if (session.folderId && configuredFolderIds.includes(session.folderId)) {
        foldersWithSecrets.add(session.folderId);
      }
    }

    // Pre-fetch secrets for each folder
    for (const folderId of foldersWithSecrets) {
      prefetchSecretsForFolder(folderId, fetchSecretsForFolder);
    }
  }, [activeSessions, configuredFolderIds, fetchSecretsForFolder]);

  /**
   * Get environment variables for a folder, merged with secrets.
   * Uses cached secrets from the pre-fetch effect.
   */
  const getEnvironmentWithSecrets = useCallback(
    (folderId: string | null): Record<string, string> | null => {
      const folderEnv = getEnvironmentForFolder(folderId);
      return getEnvironmentWithSecretsSync(folderId, folderEnv);
    },
    [getEnvironmentForFolder]
  );
  const autoFollowEnabled = userSettings?.autoFollowActiveSession ?? true;

  // Helper to get folder name by ID
  const getFolderName = useCallback(
    (folderId: string | null | undefined): string | null => {
      if (!folderId) return null;
      const folder = folders.find((f) => f.id === folderId);
      return folder?.name ?? null;
    },
    [folders]
  );

  // Generate session name based on folder context
  const generateSessionName = useCallback(
    (folderId: string | null | undefined, counter: number): string => {
      const folderName = getFolderName(folderId);
      const prefix = folderName || "Terminal";
      return `${prefix} ${counter}`;
    },
    [getFolderName]
  );

  const attachedSessionIds = useMemo(() => {
    const ids = new Set<string>();
    if (isSplitMode && activeSplit) {
      for (const splitSession of activeSplit.sessions) {
        ids.add(splitSession.sessionId);
      }
    } else if (activeSessionId) {
      ids.add(activeSessionId);
    }
    return ids;
  }, [isSplitMode, activeSplit, activeSessionId]);

  const logSessionError = useCallback((action: string, error: unknown) => {
    console.error(`Failed to ${action}:`, error);
  }, []);

  const syncSessionStatus = useCallback(
    async (sessionId: string, targetStatus: "active" | "suspended") => {
      try {
        if (targetStatus === "active") {
          await resumeSession(sessionId);
        } else {
          await suspendSession(sessionId);
        }
      } catch (error) {
        logSessionError(`${targetStatus} session`, error);
      }
    },
    [resumeSession, suspendSession, logSessionError]
  );

  useEffect(() => {
    if (sessions.length === 0) return;

    for (const session of sessions) {
      if (session.status === "closed") continue;
      const shouldBeActive = attachedSessionIds.has(session.id);
      const targetStatus = shouldBeActive ? "active" : "suspended";
      if (session.status === targetStatus) continue;

      void syncSessionStatus(session.id, targetStatus);
    }
  }, [sessions, attachedSessionIds, syncSessionStatus]);

  const maybeAutoFollowFolder = useCallback(
    (folderId: string | null) => {
      if (!autoFollowEnabled || activeProject.isPinned) return;
      if (folderId !== activeProject.folderId) {
        setActiveFolder(folderId);
      }
    },
    [autoFollowEnabled, activeProject.isPinned, activeProject.folderId, setActiveFolder]
  );

  const handleCreateSession = useCallback(
    async (data: {
      name: string;
      projectPath?: string;
      githubRepoId?: string;
      worktreeBranch?: string;
      folderId?: string;
      startupCommand?: string;
      featureDescription?: string;
      createWorktree?: boolean;
      baseBranch?: string;
    }) => {
      // Determine target folder with priority:
      // 1. Explicit folderId from wizard
      // 2. wizardFolderId from context
      // 3. For GitHub repos: folder containing other sessions from same repo
      // 4. Fall back to active folder
      let effectiveFolderId: string | null = data.folderId ?? wizardFolderId ?? null;

      // For GitHub repos without explicit folder, find existing repo folder
      if (!effectiveFolderId && data.githubRepoId) {
        const existingRepoSession = sessions.find(
          (s) => s.githubRepoId === data.githubRepoId
        );
        if (existingRepoSession) {
          effectiveFolderId = existingRepoSession.folderId || null;
        }
      }

      // Fall back to active folder
      if (!effectiveFolderId) {
        effectiveFolderId = activeProject.folderId;
      }

      const sessionData = {
        ...data,
        folderId: effectiveFolderId ?? undefined,
      };
      const newSession = await createSession(sessionData);
      // Register session-folder mapping in FolderContext for UI update
      if (newSession && effectiveFolderId) {
        registerSessionFolder(newSession.id, effectiveFolderId);
      }
      if (newSession) {
        maybeAutoFollowFolder(sessionData.folderId ?? null);
      }
      // Clear wizard folder after creation
      setWizardFolderId(null);
    },
    [
      createSession,
      wizardFolderId,
      sessions,
      activeProject.folderId,
      registerSessionFolder,
      maybeAutoFollowFolder,
    ]
  );

  const handleQuickNewSession = useCallback(async () => {
    const folderId = activeProject.folderId || undefined;
    const name = generateSessionName(folderId, sessionCounter);
    setSessionCounter((c) => c + 1);
    // Pass folderId at creation time so preferences (including startupCommand) are applied
    try {
      const newSession = await createSession({
        name,
        projectPath: currentPreferences.defaultWorkingDirectory || undefined,
        folderId,
      });
      // Register session-folder mapping in FolderContext for UI update
      if (newSession && folderId) {
        registerSessionFolder(newSession.id, folderId);
      }
      maybeAutoFollowFolder(folderId ?? null);
    } catch (error) {
      logSessionError("create session", error);
    }
  }, [
    createSession,
    sessionCounter,
    generateSessionName,
    currentPreferences.defaultWorkingDirectory,
    activeProject.folderId,
    registerSessionFolder,
    logSessionError,
    maybeAutoFollowFolder,
  ]);

  const handleCloseSession = useCallback(
    async (sessionId: string, options?: { deleteWorktree?: boolean }) => {
      void options; // Both options go to trash for recovery
      try {
        // Check if this session has a worktree - if so, trash it instead of closing
        // Both "keep worktree" and "delete worktree" options go to trash for recovery
        const session = sessions.find((s) => s.id === sessionId);
        if (session?.worktreeBranch && session?.projectPath) {
          // Trash worktree session for recovery
          const success = await trashSession(sessionId);
          if (success) {
            // Refresh sessions to remove trashed session from sidebar
            await refreshSessions();
          } else {
            // Fallback to regular close if trash fails
            await closeSession(sessionId);
          }
        } else {
          // Regular close for non-worktree sessions
          await closeSession(sessionId);
        }
      } catch (error) {
        logSessionError("close session", error);
      }
    },
    [sessions, trashSession, closeSession, refreshSessions, logSessionError]
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, newName: string) => {
      try {
        await updateSession(sessionId, { name: newName });
      } catch (error) {
        logSessionError("rename session", error);
      }
    },
    [updateSession, logSessionError]
  );

  // Open schedule modal for a session
  const handleScheduleSession = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        setScheduleTargetSession(session);
        setIsCreateScheduleOpen(true);
      }
    },
    [sessions]
  );

  // Folder handlers now use the context methods directly
  // When moving a session with a githubRepoId, move ALL sessions for that repo together
  // This enforces one folder per repository
  const handleMoveSession = useCallback(
    async (sessionId: string, folderId: string | null) => {
      const session = sessions.find((s) => s.id === sessionId);

      if (session?.githubRepoId) {
        // Find all sessions for this repo and move them together
        const repoSessions = sessions.filter(
          (s) => s.githubRepoId === session.githubRepoId
        );
        // Use allSettled to handle partial failures gracefully
        const results = await Promise.allSettled(
          repoSessions.map(async (s) => {
            await moveSessionToFolder(s.id, folderId);
            // Also update session in SessionContext for immediate UI update
            await updateSession(s.id, { folderId });
          })
        );
        const failures = results.filter((r) => r.status === "rejected");
        if (failures.length > 0) {
          console.error("Some sessions failed to move:", failures);
        }
      } else {
        // No repo association, just move this session
        await moveSessionToFolder(sessionId, folderId);
        // Also update session in SessionContext for immediate UI update
        await updateSession(sessionId, { folderId });
      }
    },
    [sessions, moveSessionToFolder, updateSession]
  );

  const handleReorderSessions = useCallback(
    async (sessionIds: string[]) => {
      try {
        await reorderSessions(sessionIds);
      } catch (error) {
        logSessionError("reorder sessions", error);
      }
    },
    [reorderSessions, logSessionError]
  );

  const handleCreateFolder = useCallback(
    async (name: string, parentId?: string | null) => {
      await createFolder(name, parentId);
    },
    [createFolder]
  );

  const handleMoveFolder = useCallback(
    async (folderId: string, newParentId: string | null) => {
      try {
        await moveFolderToParent(folderId, newParentId);
      } catch (error) {
        console.error("Failed to move folder:", error);
      }
    },
    [moveFolderToParent]
  );

  const handleReorderFolders = useCallback(
    async (folderIds: string[]) => {
      try {
        await reorderFolders(folderIds);
      } catch (error) {
        console.error("Failed to reorder folders:", error);
      }
    },
    [reorderFolders]
  );

  const handleRenameFolder = useCallback(
    async (folderId: string, newName: string) => {
      await updateFolder(folderId, { name: newName });
    },
    [updateFolder]
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      await deleteFolder(folderId);
    },
    [deleteFolder]
  );

  const handleToggleFolder = useCallback(
    async (folderId: string) => {
      await toggleFolder(folderId);
    },
    [toggleFolder]
  );

  const handleFolderSettings = useCallback(
    (folderId: string, folderName: string, initialTab?: "general" | "appearance" | "repository" | "environment") => {
      setFolderSettingsModal({ folderId, folderName, initialTab });
    },
    []
  );

  // Empty all sessions in a folder (used for .trash folder)
  const handleEmptyFolder = useCallback(
    async (folderId: string) => {
      const folderSessions = sessions.filter((s) => s.folderId === folderId && s.status !== "closed");
      if (folderSessions.length === 0) return;

      // Close all sessions in the folder permanently
      const results = await Promise.allSettled(
        folderSessions.map((s) => closeSession(s.id, { deleteWorktree: true }))
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.error("Some sessions failed to close:", failures);
      }
    },
    [sessions, closeSession]
  );

  // Get repo stats for a folder (for sidebar badges)
  // Uses resolvePreferencesForFolder to include inherited repo from parent folders
  const getFolderRepoStats = useCallback(
    (folderId: string): FolderRepoStats | null => {
      const prefs = resolvePreferencesForFolder(folderId);
      if (!prefs?.githubRepoId) return null;

      const repo = getRepositoryById(prefs.githubRepoId);
      if (!repo) return null;

      return {
        prCount: repo.stats.openPRCount,
        issueCount: repo.stats.openIssueCount,
        hasChanges: repo.hasChanges ?? false,
      };
    },
    [resolvePreferencesForFolder, getRepositoryById]
  );

  const handleFolderNewSession = useCallback(
    async (folderId: string) => {
      const prefs = resolvePreferencesForFolder(folderId);
      const name = generateSessionName(folderId, sessionCounter);
      setSessionCounter((c) => c + 1);
      // Pass folderId at creation time so preferences (including startupCommand) are applied
      try {
        const newSession = await createSession({
          name,
          projectPath: prefs.defaultWorkingDirectory || undefined,
          folderId,
        });
        // Register session-folder mapping in FolderContext for UI update
        if (newSession) {
          registerSessionFolder(newSession.id, folderId);
        }
        setActiveFolder(folderId);
      } catch (error) {
        logSessionError("create session", error);
      }
    },
    [
      createSession,
      sessionCounter,
      generateSessionName,
      resolvePreferencesForFolder,
      setActiveFolder,
      registerSessionFolder,
      logSessionError,
    ]
  );

  const handleFolderAdvancedSession = useCallback(
    (folderId: string) => {
      // Set the folder context for the wizard and open it
      setWizardFolderId(folderId);
      setActiveFolder(folderId);
      setIsWizardOpen(true);
    },
    [setActiveFolder]
  );

  const handleFolderNewWorktree = useCallback(
    async (folderId: string) => {
      // Quick worktree creation - generates branch name and creates session
      try {
        const newSession = await createSession({
          name: "Worktree",
          folderId,
          createWorktree: true,
        });
        setActiveSession(newSession.id);
      } catch (error) {
        console.error("Failed to create worktree session:", error);
      }
    },
    [createSession, setActiveSession]
  );

  // Handler for opening the wizard from Plus button or command palette
  // Sets wizardFolderId to current active folder so new sessions inherit the folder context
  const handleOpenWizard = useCallback(() => {
    setWizardFolderId(activeProject.folderId);
    setIsWizardOpen(true);
  }, [activeProject.folderId]);

  const handleFolderClick = useCallback(
    (folderId: string) => {
      setActiveFolder(folderId);
    },
    [setActiveFolder]
  );

  // Handle restarting a session with the same configuration
  const handleSessionRestart = useCallback(
    async (session: typeof activeSessions[0]) => {
      try {
        // Close the old session first
        await closeSession(session.id);

        // Create a new session with the same configuration
        // Include folderId so the session is created with folder preferences
        // (resolves defaultWorkingDirectory from folder settings)
        await createSession({
          name: session.name,
          folderId: session.folderId ?? undefined,
          projectPath: session.projectPath ?? undefined,
          githubRepoId: session.githubRepoId ?? undefined,
          worktreeBranch: session.worktreeBranch ?? undefined,
        });
      } catch (error) {
        logSessionError("restart session", error);
      }
    },
    [closeSession, createSession, logSessionError]
  );

  // Handle deleting a session (with optional worktree deletion)
  // Both options ("keep worktree" and "delete worktree") go to trash for recovery
  const handleSessionDelete = useCallback(
    async (session: typeof activeSessions[0], deleteWorktree?: boolean) => {
      void deleteWorktree; // Both options go to trash for recovery
      // For worktree sessions, always use trash for recovery
      // The trash system moves the worktree to .trash directory
      if (session.worktreeBranch && session.projectPath) {
        try {
          const success = await trashSession(session.id);
          if (success) {
            // Refresh sessions to remove trashed session from sidebar
            await refreshSessions();
            return;
          }
          // Fallback to regular close if trash fails
        } catch (error) {
          logSessionError("trash session", error);
        }
      }

      // Regular close for non-worktree sessions or if trash failed
      try {
        await closeSession(session.id);
      } catch (error) {
        logSessionError("close session", error);
      }
    },
    [closeSession, trashSession, refreshSessions, logSessionError]
  );

  // Close mobile sidebar when selecting a session
  const handleSessionClick = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
      setIsMobileSidebarOpen(false);
      // Update active folder based on the session's folder
      // Use session.folderId directly for immediate availability (not sessionFolders which loads async)
      const session = sessions.find(s => s.id === sessionId);
      const folderId = session?.folderId || null;
      maybeAutoFollowFolder(folderId);
    },
    [setActiveSession, sessions, maybeAutoFollowFolder]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Split Pane Handlers
  // ─────────────────────────────────────────────────────────────────────────

  /** Core split handler - creates a split with the given direction */
  const handleSplit = useCallback(async (direction: "horizontal" | "vertical") => {
    if (!activeSessionId) return;

    // Get the active session's folder to use for naming
    const activeSession = sessions.find(s => s.id === activeSessionId);
    const folderId = activeSession?.folderId || undefined;
    const name = generateSessionName(folderId, sessionCounter);
    setSessionCounter((c) => c + 1);

    try {
      await createSplit(activeSessionId, direction, name);
      // Refresh sessions to get the newly created split session
      await refreshSessions();
    } catch (error) {
      logSessionError("create split", error);
    }
  }, [activeSessionId, sessions, sessionCounter, generateSessionName, createSplit, refreshSessions, logSessionError]);

  /** Enter split mode horizontally */
  const handleSplitHorizontal = useCallback(() => handleSplit("horizontal"), [handleSplit]);

  /** Enter split mode vertically */
  const handleSplitVertical = useCallback(() => handleSplit("vertical"), [handleSplit]);

  // Keyboard shortcut handler - useEffectEvent always reads latest values
  // Note: Cmd+T and Cmd+W are intercepted by browsers, so we use alternatives
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    // Cmd+Enter or Ctrl+Enter for new session (not intercepted by browsers)
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      // useEffectEvent reads latest values automatically - no refs needed
      const prefix = activeProject.folderName || "Terminal";
      const name = `${prefix} ${sessionCounter}`;
      setSessionCounter((c) => c + 1);
      // Pass folderId so environment variables from folder preferences are applied
      createSession({ name, folderId: activeProject.folderId ?? undefined }).catch((error) => {
        logSessionError("create session", error);
      });
    }
    // Cmd+Shift+W or Ctrl+Shift+W to close current session
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "w") {
      if (activeSessionId) {
        e.preventDefault();
        closeSession(activeSessionId).catch((error) => {
          logSessionError("close session", error);
        });
      }
    }
    // Cmd+[ or Cmd+] to switch tabs
    if (e.metaKey && e.key === "[") {
      e.preventDefault();
      const currentIndex = activeSessions.findIndex((s) => s.id === activeSessionId);
      if (currentIndex > 0) {
        const targetSession = activeSessions[currentIndex - 1];
        setActiveSession(targetSession.id);
        maybeAutoFollowFolder(targetSession.folderId || null);
      }
    }
    if (e.metaKey && e.key === "]") {
      e.preventDefault();
      const currentIndex = activeSessions.findIndex((s) => s.id === activeSessionId);
      if (currentIndex < activeSessions.length - 1) {
        const targetSession = activeSessions[currentIndex + 1];
        setActiveSession(targetSession.id);
        maybeAutoFollowFolder(targetSession.folderId || null);
      }
    }
    // Cmd+D to split vertically (side by side)
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "d") {
      e.preventDefault();
      handleSplitVertical();
    }
    // Cmd+Shift+D to split horizontally (stacked)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "D") {
      e.preventDefault();
      handleSplitHorizontal();
    }
    // Cmd+Shift+E or Ctrl+Shift+E to split vertical (side by side)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "e") {
      if (activeSessionId) {
        e.preventDefault();
        const existingSplit = getSplitForSession(activeSessionId);
        if (!existingSplit) {
          createSplit(activeSessionId, "vertical");
        }
      }
    }
    // Cmd+Shift+O or Ctrl+Shift+O to split horizontal (stacked)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "o") {
      if (activeSessionId) {
        e.preventDefault();
        const existingSplit = getSplitForSession(activeSessionId);
        if (!existingSplit) {
          createSplit(activeSessionId, "horizontal");
        }
      }
    }
    // Cmd+Shift+U or Ctrl+Shift+U to unsplit (SplitContext)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "u") {
      if (activeSessionId) {
        e.preventDefault();
        const existingSplit = getSplitForSession(activeSessionId);
        if (existingSplit) {
          removeFromSplit(activeSessionId);
        }
      }
    }
  });

  // Keyboard shortcuts effect - empty deps since onKeyDown is an effect event
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Listen for open-folder-preferences event from Port Manager
  useEffect(() => {
    const handleOpenFolderPrefs = (e: CustomEvent<{ folderId: string }>) => {
      const { folderId } = e.detail;
      const folder = folders.find((f) => f.id === folderId);
      if (folder) {
        setFolderSettingsModal({
          folderId,
          folderName: folder.name,
          initialTab: "environment",
        });
        setIsPortsModalOpen(false); // Close port manager
      }
    };

    window.addEventListener("open-folder-preferences", handleOpenFolderPrefs as EventListener);
    return () => window.removeEventListener("open-folder-preferences", handleOpenFolderPrefs as EventListener);
  }, [folders]);

  /** Close a session in a split pane */
  const handlePaneSessionExit = useCallback(async (sessionId: string) => {
    try {
      // Removing from split also handles cleanup when only one session remains
      await removeFromSplit(sessionId);
      await closeSession(sessionId);
    } catch (error) {
      logSessionError("close session in split", error);
    }
  }, [removeFromSplit, closeSession, logSessionError]);

  /** Exit split mode, keeping all sessions as independent */
  const handleExitSplitMode = useCallback(async () => {
    if (activeSplit) {
      try {
        await dissolveSplit(activeSplit.id);
      } catch (error) {
        logSessionError("dissolve split", error);
      }
    }
  }, [activeSplit, dissolveSplit, logSessionError]);

  /** Handle pane click in split mode */
  const handlePaneClick = useCallback((sessionId: string) => {
    setActiveSession(sessionId);
  }, [setActiveSession]);

  // ─────────────────────────────────────────────────────────────────────────
  // Recording Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleStartRecording = useCallback(() => {
    startRecording();
  }, [startRecording]);

  const handleStopRecording = useCallback(() => {
    // Show modal to save the recording
    setIsSaveRecordingModalOpen(true);
  }, []);

  const handleSaveRecording = useCallback(
    async (name: string) => {
      const data = await stopRecording(name);
      if (data) {
        // Recording was saved via the onSave callback in useRecording
        setIsSaveRecordingModalOpen(false);
      }
    },
    [stopRecording]
  );

  const handleCancelSaveRecording = useCallback(() => {
    // Cancel recording - discard the data
    stopRecording();
    setIsSaveRecordingModalOpen(false);
  }, [stopRecording]);

  /** Handle resize in split mode */
  const handleSplitResize = useCallback(async (layout: Array<{ sessionId: string; size: number }>) => {
    if (!activeSplit) return;
    try {
      await updateLayout(activeSplit.id, layout);
    } catch (error) {
      logSessionError("update split layout", error);
    }
  }, [activeSplit, updateLayout, logSessionError]);

  /** Build session-to-folder mapping for SplitPaneLayout */
  const sessionFolders = useMemo(() => {
    const map: Record<string, string> = {};
    for (const session of activeSessions) {
      if (session.folderId) {
        map[session.id] = session.folderId;
      }
    }
    return map;
  }, [activeSessions]);

  // On mobile, sidebar is collapsed when drawer is not open
  const effectiveCollapsed = isMobile ? !isMobileSidebarOpen : sidebarCollapsed;

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {/* Mobile overlay when sidebar is expanded */}
      {isMobile && isMobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar - always visible, collapsed on mobile when drawer is closed */}
      <div
        className={cn(
          // Mobile: show as drawer when expanded, inline when collapsed
          isMobile && isMobileSidebarOpen && "fixed inset-y-0 left-0 z-40"
        )}
        onClick={() => {
          // On mobile, clicking the collapsed sidebar expands it
          if (isMobile && !isMobileSidebarOpen) {
            setIsMobileSidebarOpen(true);
          }
        }}
      >
        <Sidebar
            sessions={activeSessions}
            folders={folders}
            activeSessionId={activeSessionId}
            activeFolderId={activeProject.folderId}
            collapsed={effectiveCollapsed}
            onCollapsedChange={(collapsed) => {
              if (isMobile) {
                // On mobile, toggling collapsed state controls the drawer
                setIsMobileSidebarOpen(!collapsed);
              } else {
                setSidebarCollapsed(collapsed);
              }
            }}
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
            folderHasPreferences={hasFolderPreferences}
            folderHasRepo={folderHasRepo}
            getFolderRepoStats={getFolderRepoStats}
            getFolderTrashCount={getFolderTrashCount}
            onSessionClick={handleSessionClick}
            onSessionClose={handleCloseSession}
            onSessionRename={handleRenameSession}
            onSessionMove={handleMoveSession}
            onSessionReorder={handleReorderSessions}
            onNewSession={handleOpenWizard}
            onQuickNewSession={handleQuickNewSession}
            onFolderCreate={handleCreateFolder}
            onFolderRename={handleRenameFolder}
            onFolderDelete={handleDeleteFolder}
            onFolderToggle={handleToggleFolder}
            onFolderClick={handleFolderClick}
            onFolderSettings={handleFolderSettings}
            onFolderNewSession={handleFolderNewSession}
            onFolderAdvancedSession={handleFolderAdvancedSession}
            onFolderNewWorktree={handleFolderNewWorktree}
            onFolderMove={handleMoveFolder}
            onFolderReorder={handleReorderFolders}
            onFolderEmpty={handleEmptyFolder}
            onEmptyTrash={handleEmptyTrash}
            trashCount={trashCount}
            onTrashOpen={() => setIsTrashOpen(true)}
            onSessionSchedule={handleScheduleSession}
            onSessionSchedulesView={(sessionId, sessionName) => {
              setSchedulesFilterSession({ id: sessionId, name: sessionName });
              setIsSchedulesOpen(true);
            }}
            onSchedulesOpen={() => {
              setSchedulesFilterSession(null);
              setIsSchedulesOpen(true);
            }}
            onProfilesOpen={() => setIsProfilesModalOpen(true)}
            onPortsOpen={() => setIsPortsModalOpen(true)}
          />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header bar */}
        {activeSessions.length > 0 && (
          <div className="flex md:hidden items-center gap-2 px-12 py-2 border-b border-border bg-card/50">
            {mobileEditingName !== null ? (
              <input
                type="text"
                autoFocus
                value={mobileEditingName}
                onChange={(e) => setMobileEditingName(e.target.value)}
                onBlur={() => {
                  if (activeSessionId && mobileEditingName.trim()) {
                    handleRenameSession(activeSessionId, mobileEditingName.trim());
                  }
                  setMobileEditingName(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (activeSessionId && mobileEditingName.trim()) {
                      handleRenameSession(activeSessionId, mobileEditingName.trim());
                    }
                    setMobileEditingName(null);
                  } else if (e.key === "Escape") {
                    setMobileEditingName(null);
                  }
                }}
                className="flex-1 bg-input border border-primary/50 rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <span
                className="text-xs text-muted-foreground truncate flex-1 cursor-pointer hover:text-foreground transition-colors"
                onClick={() => {
                  const session = activeSessions.find((s) => s.id === activeSessionId);
                  if (session) {
                    setMobileEditingName(session.name);
                  }
                }}
              >
                {activeSessions.find((s) => s.id === activeSessionId)?.name || "No session"}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {activeSessions.length} session{activeSessions.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Empty state when no sessions */}
        {!loading && activeSessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md mx-auto px-4">
              <div className="relative p-8 rounded-2xl bg-card/50 backdrop-blur-xl border border-border shadow-2xl">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
                <div className="relative mx-auto w-16 h-16 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-6">
                  <TerminalIcon className="w-8 h-8 text-primary" />
                </div>
                <h2 className="relative text-2xl font-semibold text-foreground mb-3">
                  No Active Sessions
                </h2>
                <p className="relative text-muted-foreground mb-6">
                  Press <kbd className="px-2 py-1 bg-muted rounded text-xs">⌘↵</kbd> to
                  create a new terminal session, or use the wizard for more options.
                </p>
                <div className="flex gap-3 justify-center">
                  <Button
                    onClick={handleQuickNewSession}
                    className="relative bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Quick Terminal
                  </Button>
                  <Button
                    onClick={handleOpenWizard}
                    variant="outline"
                    className="border-border text-muted-foreground hover:bg-accent/50"
                  >
                    Advanced...
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Terminal Container */
          <div className="flex-1 p-3 overflow-hidden">
            <div className="h-full relative rounded-xl overflow-hidden">
              {/* Gradient border effect */}
              <div className="absolute inset-0 rounded-xl p-[1px] bg-gradient-to-br from-primary/30 via-transparent to-accent/30">
                <div className="absolute inset-[1px] rounded-xl bg-background" />
              </div>

              {/* Split pane controls */}
              {activeSessionId && (
                <div className="absolute top-2 right-2 z-20 flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSplitVertical}
                    title="Split vertically (⌘D)"
                    className="w-7 h-7 bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <Columns className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSplitHorizontal}
                    title="Split horizontally (⌘⇧D)"
                    className="w-7 h-7 bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <Rows className="w-4 h-4" />
                  </Button>
                  {isSplitMode && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleExitSplitMode}
                      title="Exit split mode"
                      className="w-7 h-7 bg-muted/80 hover:bg-destructive/50 text-muted-foreground hover:text-foreground"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              )}

              {/* Terminal panels */}
              <div className="relative h-full">
                {isSplitMode && activeSplit ? (
                  /* Split pane mode */
                  <SplitPaneLayout
                    splitGroup={activeSplit}
                    sessions={activeSessions}
                    activeSessionId={activeSessionId}
                    onSessionClick={handlePaneClick}
                    onResize={handleSplitResize}
                    onSessionExit={handlePaneSessionExit}
                    resolvePreferences={resolvePreferencesForFolder}
                    getEnvironmentForFolder={getEnvironmentWithSecrets}
                    sessionFolders={sessionFolders}
                    wsUrl={wsUrl}
                  />
                ) : (
                  /* Single terminal mode - only attach to the active session */
                  (() => {
                    const session = activeSessions.find((s) => s.id === activeSessionId);
                    if (!session) return null;
                    const folderId = session.folderId || null;
                    const prefs = resolvePreferencesForFolder(folderId);
                    return (
                      <div className="absolute inset-0 z-10">
                        <TerminalWithKeyboard
                          key={session.id}
                          ref={(ref) => {
                            if (ref) {
                              terminalRefsMap.current.set(session.id, ref);
                            } else {
                              terminalRefsMap.current.delete(session.id);
                            }
                          }}
                          sessionId={session.id}
                          tmuxSessionName={session.tmuxSessionName}
                          sessionName={session.name}
                          projectPath={session.projectPath}
                          session={session}
                          wsUrl={wsUrl}
                          fontSize={prefs.fontSize}
                          fontFamily={prefs.fontFamily}
                          notificationsEnabled={true}
                          isRecording={isRecording}
                          isActive={session.id === activeSessionId}
                          environmentVars={getEnvironmentWithSecrets(folderId)}
                          onOutput={isRecording ? recordOutput : undefined}
                          onDimensionsChange={isRecording ? updateDimensions : undefined}
                          onSessionRestart={() => handleSessionRestart(session)}
                          onSessionDelete={(deleteWorktree) => handleSessionDelete(session, deleteWorktree)}
                        />
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New Session Wizard */}
      <NewSessionWizard
        open={isWizardOpen}
        onClose={() => {
          setIsWizardOpen(false);
          setWizardFolderId(null);
        }}
        onCreate={handleCreateSession}
        isGitHubConnected={isGitHubConnected}
      />

      {/* Folder Preferences Modal - Activity preserves form state when closed */}
      <Activity mode={folderSettingsModal ? "visible" : "hidden"}>
        <FolderPreferencesModal
          open={folderSettingsModal !== null}
          onClose={() => setFolderSettingsModal(null)}
          folderId={folderSettingsModal?.folderId ?? ""}
          folderName={folderSettingsModal?.folderName ?? ""}
          initialTab={folderSettingsModal?.initialTab}
        />
      </Activity>

      {/* Command Palette */}
      <CommandPalette
        onNewSession={handleOpenWizard}
        onQuickNewSession={handleQuickNewSession}
        onNewFolder={() => handleCreateFolder("New Folder")}
        onOpenSettings={() => {
          // Open settings modal (could be expanded in future)
          console.log("Settings not yet implemented");
        }}
        onCloseActiveSession={
          activeSessionId
            ? () => handleCloseSession(activeSessionId)
            : undefined
        }
        onSplitHorizontal={handleSplitHorizontal}
        onSplitVertical={handleSplitVertical}
        onExitSplitMode={handleExitSplitMode}
        onSaveAsTemplate={() => setIsTemplateModalOpen(true)}
        onShowKeyboardShortcuts={() => setIsKeyboardShortcutsOpen(true)}
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
        onViewRecordings={() => setIsRecordingsModalOpen(true)}
        activeSessionId={activeSessionId}
        isSplitMode={isSplitMode}
        isRecording={isRecording}
      />

      {/* Save Template Modal */}
      <SaveTemplateModal
        open={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        session={activeSessions.find((s) => s.id === activeSessionId) || null}
      />

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsPanel
        open={isKeyboardShortcutsOpen}
        onOpenChange={setIsKeyboardShortcutsOpen}
      />

      {/* Recordings Modal */}
      <RecordingsModal
        open={isRecordingsModalOpen}
        onOpenChange={setIsRecordingsModalOpen}
      />

      {/* Save Recording Modal */}
      <SaveRecordingModal
        open={isSaveRecordingModalOpen}
        onClose={handleCancelSaveRecording}
        onSave={handleSaveRecording}
        duration={recordingDuration}
        sessionName={activeSessions.find((s) => s.id === activeSessionId)?.name}
      />

      {/* Trash Modal */}
      <TrashModal open={isTrashOpen} onClose={() => setIsTrashOpen(false)} />

      {/* Create Schedule Modal */}
      <CreateScheduleModal
        open={isCreateScheduleOpen}
        onClose={() => {
          setIsCreateScheduleOpen(false);
          setScheduleTargetSession(null);
        }}
        session={scheduleTargetSession}
      />

      {/* Schedules Management Modal */}
      <SchedulesModal
        open={isSchedulesOpen}
        onClose={() => {
          setIsSchedulesOpen(false);
          setSchedulesFilterSession(null);
        }}
        sessionId={schedulesFilterSession?.id}
        sessionName={schedulesFilterSession?.name}
      />

      {/* Profiles Modal */}
      <ProfilesModal
        open={isProfilesModalOpen}
        onClose={() => setIsProfilesModalOpen(false)}
      />

      {/* Port Manager Modal */}
      <PortManagerModal
        open={isPortsModalOpen}
        onClose={() => setIsPortsModalOpen(false)}
      />
    </div>
  );
}
