"use client";

import { X, Plus } from "lucide-react";
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
      <div className="flex items-center gap-1 px-2 py-1.5 bg-background/50 backdrop-blur-md border-b border-border">
        {/* Tabs */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-hide">
          {activeSessions.map((session) => {
            const isActive = session.id === activeSessionId;

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
                        ? "bg-primary/15 border-border text-foreground shadow-lg"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                  >
                    {/* Status indicator */}
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        isActive
                          ? "bg-primary animate-pulse"
                          : "bg-muted-foreground/50"
                      )}
                    />

                    {/* Session name */}
                    <span className="max-w-[120px] truncate">{session.name}</span>

                    {/* Close button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTabClose(session.id);
                      }}
                      className={cn(
                        "p-0.5 rounded-sm opacity-0 group-hover:opacity-100",
                        "hover:bg-accent transition-all duration-150",
                        "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <X className="w-3 h-3" />
                    </button>

                    {/* Active indicator line */}
                    {isActive && (
                      <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {session.projectPath ? (
                    <div className="space-y-1">
                      <div className="font-medium">{session.name}</div>
                      <div className="text-muted-foreground">{session.projectPath}</div>
                      {session.worktreeBranch && (
                        <div className="text-primary">
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
              className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent"
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
