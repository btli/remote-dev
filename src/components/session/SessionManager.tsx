"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Sidebar } from "./Sidebar";
import { NewSessionWizard } from "./NewSessionWizard";
import { SaveTemplateModal } from "./SaveTemplateModal";
import { FolderPreferencesModal } from "@/components/preferences/FolderPreferencesModal";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsPanel } from "@/components/KeyboardShortcutsPanel";
import { RecordingsModal } from "@/components/session/RecordingsModal";
import { SaveRecordingModal } from "@/components/session/SaveRecordingModal";
import { useSessionContext } from "@/contexts/SessionContext";
import { useRecordingContext } from "@/contexts/RecordingContext";
import { useRecording } from "@/hooks/useRecording";
import { useFolderContext } from "@/contexts/FolderContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { Terminal as TerminalIcon, Plus, X, Columns, Rows, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import {
  SplitPaneContainer,
  type PaneNode,
  createInitialLayout,
  splitPane,
  closePane,
  getAllLeaves,
  findPane,
} from "@/components/terminal/SplitPane";

// Dynamically import TerminalWithKeyboard to avoid SSR issues with xterm
const TerminalWithKeyboard = dynamic(
  () =>
    import("@/components/terminal/TerminalWithKeyboard").then(
      (mod) => mod.TerminalWithKeyboard
    ),
  { ssr: false }
);

interface SessionManagerProps {
  isGitHubConnected?: boolean;
  userEmail?: string;
}

export function SessionManager({ isGitHubConnected = false }: SessionManagerProps) {
  const {
    sessions,
    activeSessionId,
    loading,
    createSession,
    closeSession,
    updateSession,
    setActiveSession,
    reorderSessions,
  } = useSessionContext();

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardFolderId, setWizardFolderId] = useState<string | null>(null);
  const [sessionCounter, setSessionCounter] = useState(1);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Initialize from localStorage if available
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebar-collapsed");
      return saved === "true";
    }
    return false;
  });

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

  // Split pane state
  const [splitPaneLayout, setSplitPaneLayout] = useState<PaneNode | null>(null);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const isSplitMode = splitPaneLayout !== null && splitPaneLayout.type === "container";

  // Compute WebSocket URL based on current location (supports cloudflared tunnels)
  const wsUrl = useMemo(() => {
    if (typeof window === "undefined") return "ws://localhost:6002";
    const { protocol, hostname, port } = window.location;
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    if (isLocalhost) {
      // Local development: use terminal server port directly
      return `ws://localhost:${process.env.NEXT_PUBLIC_TERMINAL_PORT || "6002"}`;
    }
    // Remote access via tunnel: use /ws path (cloudflared routes to terminal server)
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${hostname}${port ? `:${port}` : ""}/ws`;
  }, []);

  // Use ref for sessionCounter to avoid stale closures in keyboard handler
  const sessionCounterRef = useRef(sessionCounter);
  useEffect(() => {
    sessionCounterRef.current = sessionCounter;
  }, [sessionCounter]);

  // Refs for split handlers (to avoid stale closures in keyboard handler)
  const splitHorizontalRef = useRef<(() => void) | null>(null);
  const splitVerticalRef = useRef<(() => void) | null>(null);

  // Persist sidebar collapsed state to localStorage
  const handleSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, []);

  // Folder state from context (persisted in database)
  const {
    folders,
    sessionFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    toggleFolder,
    moveSessionToFolder,
    moveFolderToParent,
    registerSessionFolder,
  } = useFolderContext();

  // Preferences state from context
  const {
    activeProject,
    hasFolderPreferences,
    folderHasRepo,
    currentPreferences,
    setActiveFolder,
    resolvePreferencesForFolder,
  } = usePreferencesContext();

  const activeSessions = sessions.filter((s) => s.status !== "closed");

  // Keyboard shortcuts
  // Note: Cmd+T and Cmd+W are intercepted by browsers, so we use alternatives
  // FIX: Uses refs for mutable values to avoid stale closure issues
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Enter or Ctrl+Enter for new session (not intercepted by browsers)
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        // Use ref to get current counter value (avoids stale closure)
        const name = `Terminal ${sessionCounterRef.current}`;
        setSessionCounter((c) => c + 1);
        createSession({ name });
      }
      // Cmd+Shift+W or Ctrl+Shift+W to close current session
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "w") {
        if (activeSessionId) {
          e.preventDefault();
          closeSession(activeSessionId);
        }
      }
      // Cmd+[ or Cmd+] to switch tabs
      if (e.metaKey && e.key === "[") {
        e.preventDefault();
        const currentIndex = activeSessions.findIndex((s) => s.id === activeSessionId);
        if (currentIndex > 0) {
          setActiveSession(activeSessions[currentIndex - 1].id);
        }
      }
      if (e.metaKey && e.key === "]") {
        e.preventDefault();
        const currentIndex = activeSessions.findIndex((s) => s.id === activeSessionId);
        if (currentIndex < activeSessions.length - 1) {
          setActiveSession(activeSessions[currentIndex + 1].id);
        }
      }
      // Cmd+D to split horizontally
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "d") {
        e.preventDefault();
        splitHorizontalRef.current?.();
      }
      // Cmd+Shift+D to split vertically
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "D") {
        e.preventDefault();
        splitVerticalRef.current?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSessionId, activeSessions, setActiveSession, createSession, closeSession]);

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
          effectiveFolderId = sessionFolders[existingRepoSession.id] || null;
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
      // If session was created with a folder, set it as active
      if (sessionData.folderId && newSession) {
        setActiveFolder(sessionData.folderId);
      }
      // Clear wizard folder after creation
      setWizardFolderId(null);
    },
    [createSession, wizardFolderId, sessions, sessionFolders, activeProject.folderId, setActiveFolder, registerSessionFolder]
  );

  const handleQuickNewSession = useCallback(async () => {
    const name = `Terminal ${sessionCounter}`;
    setSessionCounter((c) => c + 1);
    const folderId = activeProject.folderId || undefined;
    // Pass folderId at creation time so preferences (including startupCommand) are applied
    const newSession = await createSession({
      name,
      projectPath: currentPreferences.defaultWorkingDirectory || undefined,
      folderId,
    });
    // Register session-folder mapping in FolderContext for UI update
    if (newSession && folderId) {
      registerSessionFolder(newSession.id, folderId);
    }
  }, [createSession, sessionCounter, currentPreferences.defaultWorkingDirectory, activeProject.folderId, registerSessionFolder]);

  const handleCloseSession = useCallback(
    async (sessionId: string, options?: { deleteWorktree?: boolean }) => {
      await closeSession(sessionId, options);
    },
    [closeSession]
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, newName: string) => {
      await updateSession(sessionId, { name: newName });
    },
    [updateSession]
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
          repoSessions.map((s) => moveSessionToFolder(s.id, folderId))
        );
        const failures = results.filter((r) => r.status === "rejected");
        if (failures.length > 0) {
          console.error("Some sessions failed to move:", failures);
        }
      } else {
        // No repo association, just move this session
        await moveSessionToFolder(sessionId, folderId);
      }
    },
    [sessions, moveSessionToFolder]
  );

  const handleReorderSessions = useCallback(
    async (sessionIds: string[]) => {
      await reorderSessions(sessionIds);
    },
    [reorderSessions]
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
    (folderId: string, folderName: string) => {
      setFolderSettingsModal({ folderId, folderName });
    },
    []
  );

  const handleFolderNewSession = useCallback(
    async (folderId: string) => {
      const prefs = resolvePreferencesForFolder(folderId);
      const name = `Terminal ${sessionCounter}`;
      setSessionCounter((c) => c + 1);
      // Pass folderId at creation time so preferences (including startupCommand) are applied
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
    },
    [createSession, sessionCounter, resolvePreferencesForFolder, setActiveFolder, registerSessionFolder]
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
      // Close the old session first
      await closeSession(session.id);

      // Create a new session with the same configuration
      const newSession = await createSession({
        name: session.name,
        projectPath: session.projectPath ?? undefined,
        githubRepoId: session.githubRepoId ?? undefined,
        worktreeBranch: session.worktreeBranch ?? undefined,
      });

      // Move to the same folder if applicable
      const folderId = sessionFolders[session.id] || null;
      if (folderId && newSession) {
        await moveSessionToFolder(newSession.id, folderId);
      }
    },
    [closeSession, createSession, sessionFolders, moveSessionToFolder]
  );

  // Handle deleting a session (with optional worktree deletion)
  const handleSessionDelete = useCallback(
    async (session: typeof activeSessions[0], deleteWorktree?: boolean) => {
      // If deleting worktree, call the worktree delete API first
      if (deleteWorktree && session.githubRepoId && session.projectPath) {
        try {
          const response = await fetch("/api/github/worktrees", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              repositoryId: session.githubRepoId,
              worktreePath: session.projectPath,
              force: true, // Force delete since session is closed
            }),
          });

          if (!response.ok) {
            const error = await response.json().catch(() => ({ error: "Unknown error" }));
            console.error("Failed to delete worktree:", error);
            // Continue with session deletion even if worktree deletion fails
          }
        } catch (error) {
          console.error("Failed to delete worktree:", error);
          // Continue with session deletion even if worktree deletion fails
        }
      }

      // Close the session
      await closeSession(session.id);
    },
    [closeSession]
  );

  // Close mobile sidebar when selecting a session
  const handleSessionClick = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
      setIsMobileSidebarOpen(false);
      // Update active folder based on the session's folder
      const folderId = sessionFolders[sessionId] || null;
      setActiveFolder(folderId);
    },
    [setActiveSession, sessionFolders, setActiveFolder]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Split Pane Handlers
  // ─────────────────────────────────────────────────────────────────────────

  /** Enter split mode with a second session */
  const handleSplitHorizontal = useCallback(async () => {
    if (!activeSessionId) return;

    const name = `Terminal ${sessionCounter}`;
    setSessionCounter((c) => c + 1);

    const newSession = await createSession({
      name,
      projectPath: currentPreferences.defaultWorkingDirectory || undefined,
      folderId: activeProject.folderId || undefined,
    });

    if (newSession) {
      // Create layout if not in split mode
      if (!splitPaneLayout) {
        const initialLayout = createInitialLayout(activeSessionId);
        const newLayout = splitPane(initialLayout, initialLayout.id, "horizontal", newSession.id);
        setSplitPaneLayout(newLayout);
        setActivePaneId(initialLayout.id);
      } else if (activePaneId) {
        // Split the active pane
        const newLayout = splitPane(splitPaneLayout, activePaneId, "horizontal", newSession.id);
        setSplitPaneLayout(newLayout);
      }
    }
  }, [activeSessionId, sessionCounter, createSession, currentPreferences.defaultWorkingDirectory, activeProject.folderId, splitPaneLayout, activePaneId]);

  // Update ref when handler changes
  useEffect(() => {
    splitHorizontalRef.current = handleSplitHorizontal;
  }, [handleSplitHorizontal]);

  const handleSplitVertical = useCallback(async () => {
    if (!activeSessionId) return;

    const name = `Terminal ${sessionCounter}`;
    setSessionCounter((c) => c + 1);

    const newSession = await createSession({
      name,
      projectPath: currentPreferences.defaultWorkingDirectory || undefined,
      folderId: activeProject.folderId || undefined,
    });

    if (newSession) {
      if (!splitPaneLayout) {
        const initialLayout = createInitialLayout(activeSessionId);
        const newLayout = splitPane(initialLayout, initialLayout.id, "vertical", newSession.id);
        setSplitPaneLayout(newLayout);
        setActivePaneId(initialLayout.id);
      } else if (activePaneId) {
        const newLayout = splitPane(splitPaneLayout, activePaneId, "vertical", newSession.id);
        setSplitPaneLayout(newLayout);
      }
    }
  }, [activeSessionId, sessionCounter, createSession, currentPreferences.defaultWorkingDirectory, activeProject.folderId, splitPaneLayout, activePaneId]);

  // Update ref when handler changes
  useEffect(() => {
    splitVerticalRef.current = handleSplitVertical;
  }, [handleSplitVertical]);

  /** Close a split pane */
  const handlePaneClose = useCallback((paneId: string) => {
    if (!splitPaneLayout) return;

    const pane = findPane(splitPaneLayout, paneId);
    if (pane?.type === "leaf") {
      // Close the session associated with this pane
      closeSession(pane.sessionId);
    }

    const newLayout = closePane(splitPaneLayout, paneId);
    if (!newLayout || newLayout.type === "leaf") {
      // Exit split mode if only one pane remains
      setSplitPaneLayout(null);
      setActivePaneId(null);
    } else {
      setSplitPaneLayout(newLayout);
      // Update active pane if needed
      if (activePaneId === paneId) {
        const leaves = getAllLeaves(newLayout);
        if (leaves.length > 0) {
          setActivePaneId(leaves[0].id);
        }
      }
    }
  }, [splitPaneLayout, activePaneId, closeSession]);

  /** Exit split mode, keeping only the active session */
  const handleExitSplitMode = useCallback(() => {
    setSplitPaneLayout(null);
    setActivePaneId(null);
  }, []);

  /** Handle pane click in split mode */
  const handlePaneClick = useCallback((paneId: string) => {
    setActivePaneId(paneId);
    // Also update the active session to match the pane
    if (splitPaneLayout) {
      const pane = findPane(splitPaneLayout, paneId);
      if (pane?.type === "leaf") {
        setActiveSession(pane.sessionId);
      }
    }
  }, [splitPaneLayout, setActiveSession]);

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

  /** Render terminal for split pane */
  const renderTerminalForPane = useCallback((sessionId: string) => {
    const session = activeSessions.find((s) => s.id === sessionId);
    if (!session) return null;

    const folderId = sessionFolders[session.id] || null;
    const prefs = resolvePreferencesForFolder(folderId);
    const isActiveSession = session.id === activeSessionId;

    return (
      <TerminalWithKeyboard
        sessionId={session.id}
        tmuxSessionName={session.tmuxSessionName}
        sessionName={session.name}
        projectPath={session.projectPath}
        session={session}
        wsUrl={wsUrl}
        theme={prefs.theme}
        fontSize={prefs.fontSize}
        fontFamily={prefs.fontFamily}
        notificationsEnabled={true}
        isRecording={isRecording && isActiveSession}
        onOutput={isRecording && isActiveSession ? recordOutput : undefined}
        onDimensionsChange={isRecording && isActiveSession ? updateDimensions : undefined}
        onSessionRestart={() => handleSessionRestart(session)}
        onSessionDelete={(deleteWorktree) => handleSessionDelete(session, deleteWorktree)}
      />
    );
  }, [activeSessions, sessionFolders, resolvePreferencesForFolder, activeSessionId, isRecording, recordOutput, updateDimensions, handleSessionRestart, handleSessionDelete, wsUrl]);

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
        <div className="relative h-full">
          {/* Mobile close button - only show when expanded */}
          {isMobile && isMobileSidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setIsMobileSidebarOpen(false);
              }}
              className="absolute top-2 right-2 z-50 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
          <Sidebar
            sessions={activeSessions}
            folders={folders}
            sessionFolders={sessionFolders}
            activeSessionId={activeSessionId}
            activeFolderId={activeProject.folderId}
            collapsed={effectiveCollapsed}
            onCollapsedChange={(collapsed) => {
              if (isMobile) {
                // On mobile, toggling collapsed state controls the drawer
                setIsMobileSidebarOpen(!collapsed);
              } else {
                handleSidebarCollapsedChange(collapsed);
              }
            }}
            folderHasPreferences={hasFolderPreferences}
            folderHasRepo={folderHasRepo}
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
          />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header bar */}
        {activeSessions.length > 0 && (
          <div className="flex md:hidden items-center gap-2 px-12 py-2 border-b border-white/5 bg-slate-900/50">
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
                className="flex-1 bg-slate-800 border border-violet-500/50 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            ) : (
              <span
                className="text-xs text-slate-400 truncate flex-1 cursor-pointer hover:text-white transition-colors"
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
            <span className="text-[10px] text-slate-500">
              {activeSessions.length} session{activeSessions.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Empty state when no sessions */}
        {!loading && activeSessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md mx-auto px-4">
              <div className="relative p-8 rounded-2xl bg-slate-900/50 backdrop-blur-xl border border-white/10 shadow-2xl">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/10 via-transparent to-blue-500/10 pointer-events-none" />
                <div className="relative mx-auto w-16 h-16 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center mb-6">
                  <TerminalIcon className="w-8 h-8 text-violet-400" />
                </div>
                <h2 className="relative text-2xl font-semibold text-white mb-3">
                  No Active Sessions
                </h2>
                <p className="relative text-slate-400 mb-6">
                  Press <kbd className="px-2 py-1 bg-slate-800 rounded text-xs">⌘↵</kbd> to
                  create a new terminal session, or use the wizard for more options.
                </p>
                <div className="flex gap-3 justify-center">
                  <Button
                    onClick={handleQuickNewSession}
                    className="relative bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white shadow-lg shadow-violet-500/25"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Quick Terminal
                  </Button>
                  <Button
                    onClick={handleOpenWizard}
                    variant="outline"
                    className="border-white/10 text-slate-300 hover:bg-white/5"
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
              <div className="absolute inset-0 rounded-xl p-[1px] bg-gradient-to-br from-violet-500/30 via-transparent to-blue-500/30">
                <div className="absolute inset-[1px] rounded-xl bg-slate-950" />
              </div>

              {/* Split pane controls */}
              {activeSessionId && (
                <div className="absolute top-2 right-2 z-20 flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSplitHorizontal}
                    title="Split horizontally (⌘D)"
                    className="w-7 h-7 bg-slate-800/80 hover:bg-slate-700/80 text-slate-400 hover:text-white"
                  >
                    <Columns className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSplitVertical}
                    title="Split vertically (⌘⇧D)"
                    className="w-7 h-7 bg-slate-800/80 hover:bg-slate-700/80 text-slate-400 hover:text-white"
                  >
                    <Rows className="w-4 h-4" />
                  </Button>
                  {isSplitMode && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleExitSplitMode}
                      title="Exit split mode"
                      className="w-7 h-7 bg-slate-800/80 hover:bg-red-500/50 text-slate-400 hover:text-white"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              )}

              {/* Terminal panels */}
              <div className="relative h-full">
                {isSplitMode && splitPaneLayout ? (
                  /* Split pane mode */
                  <SplitPaneContainer
                    layout={splitPaneLayout}
                    activePaneId={activePaneId}
                    onPaneClick={handlePaneClick}
                    onPaneClose={handlePaneClose}
                    onLayoutChange={setSplitPaneLayout}
                    renderTerminal={renderTerminalForPane}
                  />
                ) : (
                  /* Single terminal mode - render all but show only active */
                  activeSessions.map((session) => {
                    const folderId = sessionFolders[session.id] || null;
                    const prefs = resolvePreferencesForFolder(folderId);
                    const isActiveSession = session.id === activeSessionId;
                    return (
                      <div
                        key={session.id}
                        className={
                          isActiveSession
                            ? "absolute inset-0 z-10"
                            : "hidden"
                        }
                      >
                        <TerminalWithKeyboard
                          sessionId={session.id}
                          tmuxSessionName={session.tmuxSessionName}
                          sessionName={session.name}
                          projectPath={session.projectPath}
                          session={session}
                          wsUrl={wsUrl}
                          theme={prefs.theme}
                          fontSize={prefs.fontSize}
                          fontFamily={prefs.fontFamily}
                          notificationsEnabled={true}
                          isRecording={isRecording && isActiveSession}
                          onOutput={isRecording && isActiveSession ? recordOutput : undefined}
                          onDimensionsChange={isRecording && isActiveSession ? updateDimensions : undefined}
                          onSessionRestart={() => handleSessionRestart(session)}
                          onSessionDelete={(deleteWorktree) => handleSessionDelete(session, deleteWorktree)}
                        />
                      </div>
                    );
                  })
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

      {/* Folder Preferences Modal */}
      {folderSettingsModal && (
        <FolderPreferencesModal
          open={true}
          onClose={() => setFolderSettingsModal(null)}
          folderId={folderSettingsModal.folderId}
          folderName={folderSettingsModal.folderName}
        />
      )}

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
            ? () => closeSession(activeSessionId)
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
        activeSessionStatus={activeSessions.find((s) => s.id === activeSessionId)?.status}
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
    </div>
  );
}
