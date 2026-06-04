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
import type { ResumableSessionSummary } from "@/types/agent-resume";
import type { AgentProviderType } from "@/types/session";
import { AGENT_PROVIDERS } from "@/types/session";
import { providerSupportsResume } from "@/lib/agent-resume/resume-providers.client";

import { apiFetch } from "@/lib/api-fetch";

/** Human-readable provider name for titles/empty states (client-safe). */
function providerLabel(provider: AgentProviderType): string {
  return AGENT_PROVIDERS.find((p) => p.id === provider)?.name ?? "Agent";
}

interface ResumeSessionModalProps {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  /** Which agent's prior sessions to discover. Defaults to Claude. */
  provider?: AgentProviderType;
  profileId?: string;
  onResume: (sessionId: string) => Promise<void>;
  limit?: number;
}

export function ResumeSessionModal({
  open,
  onClose,
  projectPath,
  provider = "claude",
  profileId,
  onResume,
  limit = 20,
}: ResumeSessionModalProps) {
  const [sessions, setSessions] = useState<ResumableSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const label = providerLabel(provider);
  const canResume = providerSupportsResume(provider);

  useEffect(() => {
    if (!open || !projectPath) return;

    // Providers without a resume mechanism (e.g. Antigravity) have nothing to
    // discover — skip the fetch and let the empty state explain.
    if (!canResume) {
      setSessions([]);
      setError(null);
      setLoading(false);
      return;
    }

    const fetchSessions = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          provider,
          projectPath,
          limit: String(limit),
        });
        if (profileId) params.set("profileId", profileId);

        // Generic multi-provider discovery (Claude keeps its rich previews;
        // codex/gemini/opencode return id + timestamp).
        const res = await apiFetch(`/api/agent/sessions?${params}`);
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
  }, [open, projectPath, provider, profileId, limit, canResume]);

  const handleResume = async (session: ResumableSessionSummary) => {
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
            Resume {label} Session
          </DialogTitle>
          <DialogDescription>
            Select a previous {label} conversation to resume in a new terminal.
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

        {!loading && !error && !canResume && (
          <div className="text-sm text-muted-foreground text-center py-10">
            {label} does not support resuming a prior conversation.
          </div>
        )}

        {!loading && !error && canResume && !projectPath && (
          <div className="text-sm text-muted-foreground text-center py-10">
            No working directory configured for this folder. Set a default working directory in folder settings to discover sessions.
          </div>
        )}

        {!loading && !error && canResume && projectPath && sessions.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-10">
            No discoverable {label} sessions found for this project.
          </div>
        )}

        {!loading && sessions.length > 0 && (
          <ScrollArea className="max-h-[380px] pr-3">
            <div className="space-y-2">
              {sessions.map((session: ResumableSessionSummary) => (
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

                  {/* First user message preview (Claude only; absent for others) */}
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
