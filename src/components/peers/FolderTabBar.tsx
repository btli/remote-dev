"use client";

/**
 * FolderTabBar -- Tab bar for switching between Terminal, Chat Room, and agent sessions.
 *
 * Three zones:
 * 1. Fixed "Terminal" tab (always visible)
 * 2. Fixed "Chat Room" tab with unread badge
 * 3. Scrollable agent session tabs with activity status dots
 */

import { TerminalSquare, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";
import type { ActiveView } from "@/types/peer-chat";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FolderTabBarProps {
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  agentSessions: TerminalSession[];
  activeSessionId: string | null;
  onAgentTabClick: (sessionId: string) => void;
  chatUnreadCount: number;
}

const TAB_BASE = "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200 shrink-0";
const TAB_ACTIVE = "bg-primary/15 text-foreground border border-border shadow-sm";
const TAB_INACTIVE = "text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent";

function getActivityDotClass(status: string | null): string {
  switch (status) {
    case "running":
      return "bg-green-500 agent-breathing";
    case "waiting":
      return "bg-yellow-500 agent-breathing";
    case "compacting":
      return "bg-blue-500 agent-breathing";
    case "error":
      return "bg-red-500";
    case "idle":
    case "ended":
    default:
      return "bg-muted-foreground/50";
  }
}

export function FolderTabBar({
  activeView,
  onViewChange,
  agentSessions,
  activeSessionId,
  onAgentTabClick,
  chatUnreadCount,
}: FolderTabBarProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-background/50 backdrop-blur-md border-b border-border shrink-0">
      <button
        onClick={() => onViewChange("terminal")}
        className={cn(TAB_BASE, activeView === "terminal" ? TAB_ACTIVE : TAB_INACTIVE)}
      >
        <TerminalSquare className="w-3.5 h-3.5" />
        Terminal
      </button>

      <button
        onClick={() => onViewChange("chat")}
        className={cn("relative", TAB_BASE, activeView === "chat" ? TAB_ACTIVE : TAB_INACTIVE)}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        Chat Room
        {chatUnreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 text-[10px] bg-primary text-primary-foreground rounded-full flex items-center justify-center px-1">
            {chatUnreadCount > 9 ? "9+" : chatUnreadCount}
          </span>
        )}
      </button>

      {agentSessions.length > 0 && (
        <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
      )}

      <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-hide">
        {agentSessions.map((session) => {
          const isActive = session.id === activeSessionId && activeView === "terminal";

          return (
            <Tooltip key={session.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onAgentTabClick(session.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-all duration-200 shrink-0 max-w-[120px]",
                    isActive
                      ? "bg-accent text-foreground border border-border/50"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border border-transparent"
                  )}
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      getActivityDotClass(session.agentActivityStatus ?? null)
                    )}
                  />
                  <span className="truncate">{session.name}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <div className="space-y-0.5">
                  <div className="font-medium">{session.name}</div>
                  {session.agentProvider && (
                    <div className="text-muted-foreground capitalize">{session.agentProvider}</div>
                  )}
                  {session.agentActivityStatus && (
                    <div className="text-muted-foreground capitalize">{session.agentActivityStatus}</div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
