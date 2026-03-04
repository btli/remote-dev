"use client";

import { useState, useEffect } from "react";
import { History, GitBranch, Clock, Loader2, Terminal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { ClaudeSessionSummary } from "@/types/claude-session";

interface ResumeSessionModalProps {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  profileId?: string;
  onResume: (sessionId: string) => Promise<void>;
  limit?: number;
}

export function ResumeSessionModal({
  open,
  onClose,
  projectPath,
  profileId,
  onResume,
  limit = 20,
}: ResumeSessionModalProps) {
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !projectPath) return;

    const fetchSessions = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          projectPath,
          limit: String(limit),
        });
        if (profileId) params.set("profileId", profileId);

        const res = await fetch(`/api/agent/claude-sessions?${params}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to load sessions");
        }
        const data = await res.json();
        setSessions(data.sessions ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sessions");
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  }, [open, projectPath, profileId, limit]);

  const handleResume = async (session: ClaudeSessionSummary) => {
    setResumingId(session.sessionId);
    try {
      await onResume(session.sessionId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume session");
    } finally {
      setResumingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v: boolean) => !v && onClose()}>
      <DialogContent className="sm:max-w-[560px] bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Resume Claude Session
          </DialogTitle>
          <DialogDescription>
            Select a previous Claude Code conversation to resume in a new terminal.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading sessions...
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive px-1 py-2">{error}</div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-10">
            No resumable sessions found for this project.
          </div>
        )}

        {!loading && sessions.length > 0 && (
          <ScrollArea className="max-h-[380px] pr-3">
            <div className="space-y-2">
              {sessions.map((session: ClaudeSessionSummary) => (
                <button
                  key={session.sessionId}
                  type="button"
                  onClick={() => handleResume(session)}
                  disabled={resumingId !== null}
                  className={cn(
                    "w-full text-left flex flex-col gap-1.5 rounded-md border px-3 py-2.5",
                    "bg-card hover:bg-accent/50 transition-colors cursor-pointer",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    resumingId === session.sessionId && "opacity-70"
                  )}
                >
                  {/* Header row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs font-mono text-muted-foreground truncate">
                        {session.sessionId.slice(0, 8)}
                      </span>
                      {session.gitBranch && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                          <GitBranch className="w-3 h-3" />
                          {session.gitBranch}
                        </span>
                      )}
                    </div>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      {resumingId === session.sessionId ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                      {formatRelativeTime(session.lastModified)}
                    </span>
                  </div>

                  {/* First user message preview */}
                  {session.firstUserMessage && (
                    <p className="text-xs text-foreground/80 line-clamp-2 leading-snug">
                      {session.firstUserMessage}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
