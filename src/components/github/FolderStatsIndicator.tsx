"use client";

/**
 * FolderStatsIndicator - Displays GitHub stats inline on folder items
 */

import { cn } from "@/lib/utils";
import {
  GitPullRequest,
  CircleDot,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FolderStats, CIStatusState } from "@/types/github-stats";

interface FolderStatsIndicatorProps {
  stats: FolderStats | null;
  compact?: boolean;
  showTooltip?: boolean;
  className?: string;
}

const ciIcons: Record<CIStatusState, typeof CheckCircle> = {
  passing: CheckCircle,
  failing: XCircle,
  pending: Clock,
  unknown: Clock,
};

const ciColors: Record<CIStatusState, string> = {
  passing: "text-green-400",
  failing: "text-red-400",
  pending: "text-amber-400",
  unknown: "text-slate-400",
};

export function FolderStatsIndicator({
  stats,
  compact = true,
  showTooltip = true,
  className,
}: FolderStatsIndicatorProps) {
  if (!stats || !stats.repository) return null;

  // Don't show if no significant data
  if (
    stats.prCount === 0 &&
    stats.issueCount === 0 &&
    !stats.ciStatus
  ) {
    return null;
  }

  const content = (
    <div className={cn("flex items-center gap-1", className)}>
      {/* PR Count */}
      {stats.prCount > 0 && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5",
            compact
              ? "text-[10px] text-violet-400"
              : "text-xs px-1.5 py-0.5 bg-violet-500/20 text-violet-400 rounded"
          )}
        >
          <GitPullRequest className="w-3 h-3" />
          {stats.prCount}
        </span>
      )}

      {/* Issue Count */}
      {stats.issueCount > 0 && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5",
            compact
              ? "text-[10px] text-emerald-400"
              : "text-xs px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded"
          )}
        >
          <CircleDot className="w-3 h-3" />
          {stats.issueCount}
        </span>
      )}

      {/* CI Status */}
      {stats.ciStatus && (
        <span className={cn("inline-flex", ciColors[stats.ciStatus])}>
          {(() => {
            const Icon = ciIcons[stats.ciStatus];
            return <Icon className="w-3 h-3" />;
          })()}
        </span>
      )}

      {/* Change indicator */}
      {stats.hasChanges && (
        <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
      )}
    </div>
  );

  if (!showTooltip) {
    return content;
  }

  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent
          side="right"
          className="bg-slate-800 border-slate-700 p-3"
        >
          <FolderStatsTooltip stats={stats} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =============================================================================
// Tooltip Content
// =============================================================================

interface FolderStatsTooltipProps {
  stats: FolderStats;
}

function FolderStatsTooltip({ stats }: FolderStatsTooltipProps) {
  const { repository } = stats;
  if (!repository) return null;

  const handleOpenGitHub = () => {
    window.open(repository.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-2 min-w-[180px]">
      {/* Repo Name */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-white">
          {repository.name}
        </span>
        <button
          onClick={handleOpenGitHub}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatItem
          label="Open PRs"
          value={stats.prCount}
          color="violet"
        />
        <StatItem
          label="Open Issues"
          value={stats.issueCount}
          color="emerald"
        />
      </div>

      {/* CI Status */}
      {stats.ciStatus && (
        <div className="flex items-center gap-2 pt-1 border-t border-slate-700">
          <span className="text-[10px] text-slate-500">CI Status:</span>
          <span
            className={cn(
              "text-[10px] font-medium capitalize",
              ciColors[stats.ciStatus]
            )}
          >
            {stats.ciStatus}
          </span>
        </div>
      )}

      {/* Recent Commits */}
      {repository.stats.recentCommits.length > 0 && (
        <div className="pt-1 border-t border-slate-700">
          <span className="text-[10px] text-slate-500 block mb-1">
            Latest commit:
          </span>
          <div className="text-[10px] text-slate-400 truncate">
            {repository.stats.recentCommits[0].message}
          </div>
        </div>
      )}
    </div>
  );
}

interface StatItemProps {
  label: string;
  value: number;
  color: "violet" | "emerald" | "amber";
}

function StatItem({ label, value, color }: StatItemProps) {
  const colorClasses = {
    violet: "text-violet-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
  };

  return (
    <div className="text-center">
      <div className={cn("text-lg font-bold", colorClasses[color])}>
        {value}
      </div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}
