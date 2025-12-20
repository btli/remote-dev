"use client";

import { useState, useCallback, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { NewSessionWizard } from "./NewSessionWizard";
import { useSessionContext } from "@/contexts/SessionContext";
import { useFolderContext } from "@/contexts/FolderContext";
import { Terminal as TerminalIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [sessionCounter, setSessionCounter] = useState(1);

  // Folder state from context (persisted in database)
  const {
    folders,
    sessionFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    toggleFolder,
    moveSessionToFolder,
  } = useFolderContext();

  const activeSessions = sessions.filter((s) => s.status !== "closed");

  // Keyboard shortcuts
  // Note: Cmd+T and Cmd+W are intercepted by browsers, so we use alternatives
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Enter or Ctrl+Enter for new session (not intercepted by browsers)
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        const name = `Terminal ${sessionCounter}`;
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
  }, [activeSessionId, activeSessions, setActiveSession, sessionCounter, createSession, closeSession]);

  const handleCreateSession = useCallback(
    async (data: {
      name: string;
      projectPath?: string;
      githubRepoId?: string;
      worktreeBranch?: string;
    }) => {
      await createSession(data);
    },
    [createSession]
  );

  const handleQuickNewSession = useCallback(async () => {
    const name = `Terminal ${sessionCounter}`;
    setSessionCounter((c) => c + 1);
    await createSession({ name });
  }, [createSession, sessionCounter]);

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
    async (name: string) => {
      await createFolder(name);
    },
    [createFolder]
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

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        sessions={activeSessions}
        folders={folders}
        sessionFolders={sessionFolders}
        activeSessionId={activeSessionId}
        onSessionClick={setActiveSession}
        onSessionClose={handleCloseSession}
        onSessionRename={handleRenameSession}
        onSessionMove={handleMoveSession}
        onNewSession={() => setIsWizardOpen(true)}
        onQuickNewSession={handleQuickNewSession}
        onFolderCreate={handleCreateFolder}
        onFolderRename={handleRenameFolder}
        onFolderDelete={handleDeleteFolder}
        onFolderToggle={handleToggleFolder}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
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
                {activeSessions.map((session) => (
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
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New Session Wizard */}
      <NewSessionWizard
        open={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onCreate={handleCreateSession}
        isGitHubConnected={isGitHubConnected}
      />
    </div>
  );
}
