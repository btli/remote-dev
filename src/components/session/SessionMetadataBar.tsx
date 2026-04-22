"use client";

import { cn } from "@/lib/utils";
import {
  GitBranch,
  ArrowUp,
  ArrowDown,
  GitPullRequest,
  Radio,
} from "lucide-react";
import { useSessionGitStatus } from "@/hooks/useSessionGitStatus";
import { usePortContext } from "@/contexts/PortContext";
import type { TerminalSession } from "@/types/session";

interface SessionMetadataBarProps {
  session: TerminalSession;
  isCollapsed?: boolean;
}

export function SessionMetadataBar({
  session,
  isCollapsed,
}: SessionMetadataBarProps) {
  const { gitStatus } = useSessionGitStatus(session.id, !isCollapsed);
  const { allocations } = usePortContext();

  // Get ports for this session's project
  const sessionPorts = session.projectId
    ? allocations.filter((p) => p.folderId === session.projectId)
    : [];

  if (isCollapsed) return null;
  if (!gitStatus && sessionPorts.length === 0) return null;

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

      {/* Port chips */}
      {sessionPorts.map((port) => (
        <span
          key={port.port}
          className="inline-flex items-center gap-0.5 text-[10px] text-blue-400 bg-blue-400/10 rounded px-1 py-0.5"
        >
          <Radio className="w-2.5 h-2.5" />:{port.port}
        </span>
      ))}
    </div>
  );
}
