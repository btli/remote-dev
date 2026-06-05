"use client";

import { cn } from "@/lib/utils";
import {
  GitBranch,
  ArrowUp,
  ArrowDown,
  GitPullRequest,
  Radio,
  ExternalLink,
  FileDiff,
} from "lucide-react";
import { useSessionMetadata } from "@/hooks/useSessionMetadata";
import { usePortContext } from "@/contexts/PortContext";
import type { TerminalSession } from "@/types/session";
import { AGENT_VISUALS } from "./project-tree/agentVisuals";
import { prefixPath } from "@/lib/base-path";

interface SessionMetadataBarProps {
  session: TerminalSession;
  isCollapsed?: boolean;
  /**
   * Optional override: when provided, a session-owned port chip calls
   * `onOpenPort(port)` instead of the default behavior (open the in-pod proxy
   * URL from `PortContext.getProxyUrl` in a new tab). Used by mobile callers.
   */
  onOpenPort?: (port: number) => void;
}

/**
 * [n6uc] At-a-glance per-session observability for a tree row: live branch +
 * dirty count + ahead/behind, the linked PR (with review/CI tone), the
 * session's OWN listening ports (PID-tree attributed) with quick-open through
 * the existing authenticated port-proxy, and a worktree-diff link. Reads
 * `useSessionMetadata` (polled + WS-pushed). Needs-attention is now shown as a
 * glow halo on the session ICON (see getAttentionGlowClass), not a dot here.
 */
export function SessionMetadataBar({
  session,
  isCollapsed,
  onOpenPort,
}: SessionMetadataBarProps) {
  const { metadata } = useSessionMetadata(session.id, !isCollapsed);
  const { getProxyUrl } = usePortContext();

  // Open a session-owned port. Prefer an explicit override; otherwise open the
  // in-pod proxy URL in a new tab. `noopener,noreferrer` so the proxied app
  // can't reach back via `window.opener`.
  const handleOpenPort = (port: number) => {
    if (onOpenPort) {
      onOpenPort(port);
      return;
    }
    const url = getProxyUrl?.(port);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  if (isCollapsed) return null;

  const git = metadata?.git;
  const pr = metadata?.pr;
  const ports = metadata?.ports ?? [];

  const isAgentTerminal =
    session.terminalType === "agent" || session.terminalType === "loop";
  const hasAgent = Boolean(
    isAgentTerminal &&
      session.agentProvider &&
      session.agentProvider !== "none" &&
      AGENT_VISUALS[session.agentProvider],
  );

  if (!git?.branch && ports.length === 0 && !pr && !hasAgent) {
    return null;
  }

  // PR tone: red when blocked (changes requested / CI failing), green when an
  // open PR is healthy, purple when closed/merged.
  const prTone =
    pr?.reviewDecision === "CHANGES_REQUESTED" || pr?.ciStatus === "failing"
      ? "text-red-400 bg-red-400/10"
      : pr?.state === "open"
        ? "text-green-400 bg-green-400/10"
        : "text-purple-400 bg-purple-400/10";

  return (
    <div className="flex flex-wrap gap-1 mt-0.5 px-1">
      {/* Branch chip: name + ahead/behind + dirty count */}
      {git?.branch && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 bg-muted/30 rounded px-1 py-0.5 max-w-[140px]">
          <GitBranch className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">{git.branch}</span>
          {git.ahead > 0 && (
            <span className="inline-flex items-center text-green-400">
              <ArrowUp className="w-2 h-2" />
              {git.ahead}
            </span>
          )}
          {git.behind > 0 && (
            <span className="inline-flex items-center text-orange-400">
              <ArrowDown className="w-2 h-2" />
              {git.behind}
            </span>
          )}
          {git.dirtyCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-amber-400"
              title={`${git.dirtyCount} uncommitted change${git.dirtyCount === 1 ? "" : "s"}`}
            >
              <FileDiff className="w-2 h-2" />
              {git.dirtyCount}
            </span>
          )}
        </span>
      )}

      {/* Worktree-diff link (only when there's something to review) */}
      {git && (git.dirtyCount > 0 || git.ahead > 0) && (
        <a
          href={prefixPath(`/sessions/${session.id}/diff`)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="View worktree diff"
          aria-label="View worktree diff"
          className="inline-flex items-center text-[10px] text-muted-foreground/70 bg-muted/30 rounded px-1 py-0.5 hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <FileDiff className="w-2.5 h-2.5" />
        </a>
      )}

      {/* PR chip with review/CI tone */}
      {pr && (
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`PR #${pr.number}${pr.isDraft ? " (draft)" : ""}${pr.reviewDecision ? ` — ${pr.reviewDecision}` : ""}${pr.ciStatus ? ` — CI ${pr.ciStatus}` : ""}`}
          className={cn(
            "inline-flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5 hover:underline",
            prTone,
          )}
        >
          <GitPullRequest className="w-2.5 h-2.5" />#{pr.number}
          {pr.isDraft ? <span className="opacity-70">·draft</span> : null}
        </a>
      )}

      {/* Active agent chip */}
      {isAgentTerminal &&
        session.agentProvider &&
        AGENT_VISUALS[session.agentProvider] &&
        (() => {
          const config = AGENT_VISUALS[session.agentProvider]!;
          const AgentIcon = config.icon;
          return (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[10px] border rounded px-1 py-0.5 shrink-0",
                config.classes,
              )}
            >
              <AgentIcon className="w-2.5 h-2.5 shrink-0" />
              <span>{config.label}</span>
            </span>
          );
        })()}

      {/* Per-session listening-port chips (quick-open via the port-proxy) */}
      {ports.map((p) => {
        const canOpen = Boolean(onOpenPort) || getProxyUrl?.(p.port) != null;
        const chipClasses = cn(
          "inline-flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5",
          "text-emerald-400 bg-emerald-400/10",
        );
        if (canOpen) {
          return (
            <button
              key={p.port}
              type="button"
              onClick={() => handleOpenPort(p.port)}
              title={p.process ? `Open ${p.process} on :${p.port}` : `Open port ${p.port}`}
              aria-label={`Open port ${p.port}`}
              className={cn(
                chipClasses,
                "hover:bg-emerald-400/20 transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/50",
              )}
            >
              <Radio className="w-2.5 h-2.5" />:{p.port}
              <ExternalLink className="w-2 h-2" />
            </button>
          );
        }
        return (
          <span
            key={p.port}
            className={chipClasses}
            title={p.process ? `${p.process} on :${p.port}` : `Port ${p.port}`}
          >
            <Radio className="w-2.5 h-2.5" />:{p.port}
          </span>
        );
      })}
    </div>
  );
}
