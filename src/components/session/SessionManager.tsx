"use client";

import { useState, useCallback } from "react";
import { Terminal } from "@/components/terminal/Terminal";
import { TabBar } from "./TabBar";
import { NewSessionWizard } from "./NewSessionWizard";
import { useSessionContext } from "@/contexts/SessionContext";
import { Plus, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    setActiveSession,
  } = useSessionContext();

  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const activeSessions = sessions.filter((s) => s.status !== "closed");

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

  const handleCloseSession = useCallback(
    async (sessionId: string) => {
      await closeSession(sessionId);
    },
    [closeSession]
  );

  // Empty state when no sessions
  if (!loading && activeSessions.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md mx-auto px-4">
            {/* Glassmorphism card */}
            <div className="relative p-8 rounded-2xl bg-slate-900/50 backdrop-blur-xl border border-white/10 shadow-2xl">
              {/* Gradient glow effect */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/10 via-transparent to-blue-500/10 pointer-events-none" />

              {/* Terminal icon with gradient */}
              <div className="relative mx-auto w-16 h-16 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center mb-6">
                <TerminalIcon className="w-8 h-8 text-violet-400" />
              </div>

              <h2 className="relative text-2xl font-semibold text-white mb-3">
                No Active Sessions
              </h2>
              <p className="relative text-slate-400 mb-6">
                Create a new terminal session to get started. Your sessions persist
                even after closing the browser.
              </p>

              <Button
                onClick={() => setIsWizardOpen(true)}
                size="lg"
                className="relative bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white shadow-lg shadow-violet-500/25"
              >
                <Plus className="w-5 h-5 mr-2" />
                New Session
              </Button>
            </div>
          </div>
        </div>

        <NewSessionWizard
          open={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          onCreate={handleCreateSession}
          isGitHubConnected={isGitHubConnected}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab Bar */}
      <TabBar
        sessions={activeSessions}
        activeSessionId={activeSessionId}
        onTabClick={setActiveSession}
        onTabClose={handleCloseSession}
        onNewSession={() => setIsWizardOpen(true)}
      />

      {/* Terminal Container with glassmorphism border */}
      <div className="flex-1 p-4 overflow-hidden">
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
                className={cn(
                  "absolute inset-0 transition-opacity duration-200",
                  session.id === activeSessionId
                    ? "opacity-100 z-10"
                    : "opacity-0 pointer-events-none z-0"
                )}
              >
                <Terminal
                  sessionId={session.id}
                  tmuxSessionName={session.tmuxSessionName}
                />
              </div>
            ))}
          </div>
        </div>
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
