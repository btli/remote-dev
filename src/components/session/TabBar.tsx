"use client";

import { X, Plus, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TabBarProps {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  onTabClick: (sessionId: string) => void;
  onTabClose: (sessionId: string) => void;
  onNewSession: () => void;
}

export function TabBar({
  sessions,
  activeSessionId,
  onTabClick,
  onTabClose,
  onNewSession,
}: TabBarProps) {
  const activeSessions = sessions.filter((s) => s.status !== "closed");

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1 px-2 py-1.5 bg-slate-900/50 backdrop-blur-md border-b border-white/5">
        {/* Tabs */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-hide">
          {activeSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isSuspended = session.status === "suspended";

            return (
              <Tooltip key={session.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onTabClick(session.id)}
                    className={cn(
                      "group relative flex items-center gap-2 px-3 py-1.5 rounded-md",
                      "text-sm font-medium transition-all duration-200",
                      "border border-transparent",
                      isActive
                        ? "bg-gradient-to-br from-violet-500/20 via-purple-500/15 to-blue-500/20 border-white/10 text-white shadow-lg"
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    )}
                  >
                    {/* Status indicator */}
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        isSuspended
                          ? "bg-amber-400"
                          : isActive
                          ? "bg-green-400 animate-pulse"
                          : "bg-slate-500"
                      )}
                    />

                    {/* Session name */}
                    <span className="max-w-[120px] truncate">{session.name}</span>

                    {/* Suspended indicator */}
                    {isSuspended && (
                      <Pause className="w-3 h-3 text-amber-400" />
                    )}

                    {/* Close button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTabClose(session.id);
                      }}
                      className={cn(
                        "p-0.5 rounded-sm opacity-0 group-hover:opacity-100",
                        "hover:bg-white/10 transition-all duration-150",
                        "text-slate-400 hover:text-white"
                      )}
                    >
                      <X className="w-3 h-3" />
                    </button>

                    {/* Active indicator line */}
                    {isActive && (
                      <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-violet-500 to-purple-500 rounded-full" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {session.projectPath ? (
                    <div className="space-y-1">
                      <div className="font-medium">{session.name}</div>
                      <div className="text-slate-400">{session.projectPath}</div>
                      {session.worktreeBranch && (
                        <div className="text-purple-400">
                          Branch: {session.worktreeBranch}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span>{session.name}</span>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* New Session Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={onNewSession}
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-slate-400 hover:text-white hover:bg-white/10"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New Session</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
