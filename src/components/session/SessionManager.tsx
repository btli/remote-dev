"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Sidebar } from "./Sidebar";
import { NewSessionWizard } from "./NewSessionWizard";
import { FolderPreferencesModal } from "@/components/preferences/FolderPreferencesModal";
import { CommandPalette } from "@/components/CommandPalette";
import { useSessionContext } from "@/contexts/SessionContext";
import { useFolderContext } from "@/contexts/FolderContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { Terminal as TerminalIcon, Plus, PanelLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

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
  } = useSessionContext();

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardFolderId, setWizardFolderId] = useState<string | null>(null);
  const [sessionCounter, setSessionCounter] = useState(1);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [folderSettingsModal, setFolderSettingsModal] = useState<{
    folderId: string;
    folderName: string;
  } | null>(null);

  // Use ref for sessionCounter to avoid stale closures in keyboard handler
  const sessionCounterRef = useRef(sessionCounter);
  useEffect(() => {
    sessionCounterRef.current = sessionCounter;
  }, [sessionCounter]);

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
  } = useFolderContext();

  // Preferences state from context
  const {
    activeProject,
    hasFolderPreferences,
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
      // Include wizard folder or active folder if not explicitly provided
      const effectiveFolderId = data.folderId ?? wizardFolderId ?? activeProject.folderId ?? undefined;
      const sessionData = {
        ...data,
        folderId: effectiveFolderId,
      };
      const newSession = await createSession(sessionData);
      // If session was created with a folder, set it as active
      if (sessionData.folderId && newSession) {
        setActiveFolder(sessionData.folderId);
      }
      // Clear wizard folder after creation
      setWizardFolderId(null);
    },
    [createSession, wizardFolderId, activeProject.folderId, setActiveFolder]
  );

  const handleQuickNewSession = useCallback(async () => {
    const name = `Terminal ${sessionCounter}`;
    setSessionCounter((c) => c + 1);
    // Pass folderId at creation time so preferences (including startupCommand) are applied
    await createSession({
      name,
      projectPath: currentPreferences.defaultWorkingDirectory || undefined,
      folderId: activeProject.folderId || undefined,
    });
  }, [createSession, sessionCounter, currentPreferences.defaultWorkingDirectory, activeProject.folderId]);

  const handleCloseSession = useCallback(
    async (sessionId: string) => {
      await closeSession(sessionId);
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
  const handleMoveSession = useCallback(
    async (sessionId: string, folderId: string | null) => {
      await moveSessionToFolder(sessionId, folderId);
    },
    [moveSessionToFolder]
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
      await createSession({
        name,
        projectPath: prefs.defaultWorkingDirectory || undefined,
        folderId,
      });
      setActiveFolder(folderId);
    },
    [createSession, sessionCounter, resolvePreferencesForFolder, setActiveFolder]
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

  const handleFolderClick = useCallback(
    (folderId: string) => {
      setActiveFolder(folderId);
    },
    [setActiveFolder]
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

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {/* Mobile sidebar toggle button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsMobileSidebarOpen(true)}
        className={cn(
          "absolute top-2 left-2 z-20 md:hidden",
          "bg-slate-800/80 backdrop-blur-sm hover:bg-slate-700/80",
          "text-slate-300 hover:text-white"
        )}
      >
        <PanelLeft className="w-5 h-5" />
      </Button>

      {/* Mobile overlay */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar - hidden on mobile unless toggled */}
      <div
        className={cn(
          // Desktop: always visible
          "hidden md:block",
          // Mobile: slide-in drawer
          isMobileSidebarOpen && "!block fixed inset-y-0 left-0 z-40"
        )}
      >
        <div className="relative h-full">
          {/* Mobile close button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMobileSidebarOpen(false)}
            className="absolute top-2 right-2 z-50 md:hidden text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </Button>
          <Sidebar
            sessions={activeSessions}
            folders={folders}
            sessionFolders={sessionFolders}
            activeSessionId={activeSessionId}
            activeFolderId={activeProject.folderId}
            folderHasPreferences={hasFolderPreferences}
            onSessionClick={handleSessionClick}
            onSessionClose={handleCloseSession}
            onSessionRename={handleRenameSession}
            onSessionMove={handleMoveSession}
            onNewSession={() => setIsWizardOpen(true)}
            onQuickNewSession={handleQuickNewSession}
            onFolderCreate={handleCreateFolder}
            onFolderRename={handleRenameFolder}
            onFolderDelete={handleDeleteFolder}
            onFolderToggle={handleToggleFolder}
            onFolderClick={handleFolderClick}
            onFolderSettings={handleFolderSettings}
            onFolderNewSession={handleFolderNewSession}
            onFolderAdvancedSession={handleFolderAdvancedSession}
            onFolderMove={handleMoveFolder}
          />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header bar */}
        {activeSessions.length > 0 && (
          <div className="flex md:hidden items-center gap-2 px-12 py-2 border-b border-white/5 bg-slate-900/50">
            <span className="text-xs text-slate-400 truncate flex-1">
              {activeSessions.find((s) => s.id === activeSessionId)?.name || "No session"}
            </span>
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
                    onClick={() => setIsWizardOpen(true)}
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

              {/* Terminal panels - render all but show only active */}
              <div className="relative h-full">
                {activeSessions.map((session) => {
                  const folderId = sessionFolders[session.id] || null;
                  const prefs = resolvePreferencesForFolder(folderId);
                  return (
                    <div
                      key={session.id}
                      className={
                        session.id === activeSessionId
                          ? "absolute inset-0 z-10"
                          : "hidden"
                      }
                    >
                      <TerminalWithKeyboard
                        sessionId={session.id}
                        tmuxSessionName={session.tmuxSessionName}
                        theme={prefs.theme}
                        fontSize={prefs.fontSize}
                        fontFamily={prefs.fontFamily}
                        onSessionExit={() => closeSession(session.id)}
                      />
                    </div>
                  );
                })}
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
        onNewSession={() => setIsWizardOpen(true)}
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
        activeSessionId={activeSessionId}
        activeSessionStatus={activeSessions.find((s) => s.id === activeSessionId)?.status}
      />
    </div>
  );
}
