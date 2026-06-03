"use client";

import { cn } from "@/lib/utils";
import {
  GitBranch,
  ArrowUp,
  ArrowDown,
  GitPullRequest,
  Radio,
  ExternalLink,
} from "lucide-react";
import { useSessionGitStatus } from "@/hooks/useSessionGitStatus";
import { usePortContext } from "@/contexts/PortContext";
import type { TerminalSession } from "@/types/session";
import { AGENT_VISUALS } from "./project-tree/agentVisuals";

interface SessionMetadataBarProps {
  session: TerminalSession;
  isCollapsed?: boolean;
  /**
   * Seam (A5): when provided, a live/listening port chip becomes a clickable
   * button that calls `onOpenPort(port)`. Track B (B2 / remote-dev-kmrx) passes
   * a handler that opens the in-pod proxy URL; until then the chip stays inert.
   */
  onOpenPort?: (port: number) => void;
}

export function SessionMetadataBar({
  session,
  isCollapsed,
  onOpenPort,
}: SessionMetadataBarProps) {
  const { gitStatus } = useSessionGitStatus(session.id, !isCollapsed);
  const { allocations, isPortActive } = usePortContext();

  // Get ports for this session's project
  const sessionPorts = session.projectId
    ? allocations.filter((p) => p.folderId === session.projectId)
    : [];

  const isAgentTerminal =
    session.terminalType === "agent" || session.terminalType === "loop";

  const hasAgent =
    isAgentTerminal &&
    session.agentProvider &&
    session.agentProvider !== "none" &&
    AGENT_VISUALS[session.agentProvider];

  if (isCollapsed) return null;
  if (!gitStatus && sessionPorts.length === 0 && !hasAgent) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-0.5 px-1">
      {/* Branch chip with ahead/behind */}
      {gitStatus?.branch && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 bg-muted/30 rounded px-1 py-0.5 max-w-[120px] truncate">
          <GitBranch className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">{gitStatus.branch}</span>
          {gitStatus.ahead > 0 && (
            <span className="inline-flex items-center text-green-400">
              <ArrowUp className="w-2 h-2" />
              {gitStatus.ahead}
            </span>
          )}
          {gitStatus.behind > 0 && (
            <span className="inline-flex items-center text-orange-400">
              <ArrowDown className="w-2 h-2" />
              {gitStatus.behind}
            </span>
          )}
        </span>
      )}

      {/* PR chip */}
      {gitStatus?.pr && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5",
            gitStatus.pr.state === "open"
              ? "text-green-400 bg-green-400/10"
              : "text-purple-400 bg-purple-400/10"
          )}
        >
          <GitPullRequest className="w-2.5 h-2.5" />#{gitStatus.pr.number}
        </span>
      )}

      {/* Active Agent Chip */}
      {isAgentTerminal && session.agentProvider && AGENT_VISUALS[session.agentProvider] && (
        (() => {
          const config = AGENT_VISUALS[session.agentProvider]!;
          const AgentIcon = config.icon;
          return (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[10px] border rounded px-1 py-0.5 shrink-0",
                config.classes
              )}
            >
              <AgentIcon className="w-2.5 h-2.5 shrink-0" />
              <span>{config.label}</span>
            </span>
          );
        })()
      )}

      {/* Port chips */}
      {sessionPorts.map((port) => {
        // `isPortActive` may be absent under stubbed contexts; treat as idle.
        const active = isPortActive?.(port.port) ?? false;
        const canOpen = active && Boolean(onOpenPort);

        const chipClasses = cn(
          "inline-flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5",
          active
            ? "text-emerald-400 bg-emerald-400/10"
            : "text-muted-foreground/70 bg-muted/30"
        );

        if (canOpen) {
          return (
            <button
              key={port.port}
              type="button"
              onClick={() => onOpenPort?.(port.port)}
              title={`Open port ${port.port}`}
              aria-label={`Open port ${port.port}`}
              className={cn(
                chipClasses,
                "hover:bg-emerald-400/20 transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/50"
              )}
            >
              <Radio className="w-2.5 h-2.5" />:{port.port}
              <ExternalLink className="w-2 h-2" />
            </button>
          );
        }

        return (
          <span
            key={port.port}
            className={chipClasses}
            title={active ? `Port ${port.port} active` : `Port ${port.port} idle`}
          >
            <Radio className="w-2.5 h-2.5" />:{port.port}
          </span>
        );
      })}
    </div>
  );
}
