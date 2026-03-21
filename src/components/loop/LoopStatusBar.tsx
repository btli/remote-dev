"use client";

/**
 * LoopStatusBar — Header for loop agent sessions
 *
 * Shows session name, agent activity status, loop type indicator,
 * iteration count, and terminal toggle button.
 */

import { MessageCircle, Timer, Terminal, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentActivityStatus } from "@/types/terminal-type";
import type { LoopType } from "@/types/loop-agent";

interface LoopStatusBarProps {
  sessionName: string;
  loopType: LoopType;
  activityStatus: AgentActivityStatus | string;
  currentIteration: number;
  terminalVisible: boolean;
  onToggleTerminal: () => void;
  isPaused?: boolean;
  onTogglePause?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  running: "Working",
  waiting: "Waiting for you",
  idle: "Idle",
  error: "Error",
  compacting: "Thinking",
};

const STATUS_COLORS: Record<string, string> = {
  running: "bg-green-500",
  waiting: "bg-amber-500",
  idle: "bg-muted-foreground/50",
  error: "bg-red-500",
  compacting: "bg-blue-500",
};

export function LoopStatusBar({
  sessionName,
  loopType,
  activityStatus,
  currentIteration,
  terminalVisible,
  onToggleTerminal,
  isPaused = false,
  onTogglePause,
}: LoopStatusBarProps) {
  const statusLabel = STATUS_LABELS[activityStatus] ?? activityStatus;
  const statusColor = STATUS_COLORS[activityStatus] ?? "bg-muted-foreground/50";
  const isRunning = activityStatus === "running" || activityStatus === "compacting";

  return (
    <div className="flex-none flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-background/80 backdrop-blur-sm pt-safe-top">
      {/* Left: session name + status */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {loopType === "monitoring" ? (
          <Timer className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <MessageCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <span className="text-sm font-medium truncate">{sessionName}</span>
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full flex-shrink-0",
              statusColor,
              isRunning && "animate-pulse"
            )}
          />
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Right: iteration badge + controls */}
      <div className="flex items-center gap-1.5">
        {loopType === "monitoring" && currentIteration > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
            #{currentIteration}
          </Badge>
        )}

        {loopType === "monitoring" && onTogglePause && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onTogglePause}
          >
            {isPaused ? (
              <Play className="w-3.5 h-3.5" />
            ) : (
              <Pause className="w-3.5 h-3.5" />
            )}
          </Button>
        )}

        <Button
          variant={terminalVisible ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          onClick={onToggleTerminal}
        >
          <Terminal className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
