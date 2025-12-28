"use client";

import { Terminal, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TmuxSessionResponse } from "@/types/tmux";
import { cn } from "@/lib/utils";

interface TmuxSessionListProps {
  sessions: TmuxSessionResponse[];
  onTerminate: (sessionName: string) => void;
  terminating: string | null;
}

/**
 * Formats a relative time string from a date.
 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  }
  if (diffHours > 0) {
    return `${diffHours}h ago`;
  }
  if (diffMinutes > 0) {
    return `${diffMinutes}m ago`;
  }
  return "Just now";
}

export function TmuxSessionList({
  sessions,
  onTerminate,
  terminating,
}: TmuxSessionListProps) {
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-3 rounded-lg bg-muted/50 border border-border">
        No tmux sessions found
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <div
          key={session.name}
          className={cn(
            "flex items-center justify-between p-3 rounded-lg border transition-colors",
            session.isOrphaned
              ? "bg-destructive/5 border-destructive/20"
              : "bg-muted/50 border-border"
          )}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Terminal
              className={cn(
                "w-4 h-4 shrink-0",
                session.attached ? "text-primary" : "text-muted-foreground"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono truncate" title={session.name}>
                  {session.name}
                </span>
                {session.isOrphaned && (
                  <Badge variant="destructive" className="shrink-0">
                    Orphaned
                  </Badge>
                )}
                {session.attached && (
                  <Badge variant="outline" className="shrink-0">
                    Attached
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <span>{session.windowCount} window{session.windowCount !== 1 ? "s" : ""}</span>
                <span className="text-border">•</span>
                <span>{formatRelativeTime(session.created)}</span>
                {session.folderName && (
                  <>
                    <span className="text-border">•</span>
                    <span>{session.folderName}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onTerminate(session.name)}
            disabled={terminating === session.name}
            title="Terminate session"
          >
            {terminating === session.name ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <X className="w-4 h-4" />
            )}
          </Button>
        </div>
      ))}
    </div>
  );
}
