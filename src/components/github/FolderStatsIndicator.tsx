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
  unknown: "text-muted-foreground",
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
              ? "text-[10px] text-primary"
              : "text-xs px-1.5 py-0.5 bg-primary/20 text-primary rounded"
          )}
        >
          <GitPullRequest className="w-3 h-3" />
          {stats.prCount}
        </span>
      )}

      {/* Issue Count - uses chart-2 for distinction from PRs */}
      {stats.issueCount > 0 && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5",
            compact
              ? "text-[10px] text-chart-2"
              : "text-xs px-1.5 py-0.5 bg-chart-2/20 text-chart-2 rounded"
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
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
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
          className="bg-card border-border p-3"
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
        <span className="text-xs font-medium text-foreground">
          {repository.name}
        </span>
        <button
          onClick={handleOpenGitHub}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatItem
          label="Open PRs"
          value={stats.prCount}
          color="primary"
        />
        <StatItem
          label="Open Issues"
          value={stats.issueCount}
          color="chart-2"
        />
      </div>

      {/* CI Status */}
      {stats.ciStatus && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <span className="text-[10px] text-muted-foreground">CI Status:</span>
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
        <div className="pt-1 border-t border-border">
          <span className="text-[10px] text-muted-foreground block mb-1">
            Latest commit:
          </span>
          <div className="text-[10px] text-muted-foreground truncate">
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
  color: "primary" | "chart-2" | "amber";
}

function StatItem({ label, value, color }: StatItemProps) {
  const colorClasses = {
    primary: "text-primary",
    "chart-2": "text-chart-2",
    amber: "text-amber-400",
  };

  return (
    <div className="text-center">
      <div className={cn("text-lg font-bold", colorClasses[color])}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
