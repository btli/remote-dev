"use client";

/**
 * StatusBadge - Displays CI status, PR counts, issue counts with appropriate colors
 */

import { cn } from "@/lib/utils";
import {
  CheckCircle,
  XCircle,
  Clock,
  HelpCircle,
  GitPullRequest,
  CircleDot,
  Shield,
} from "lucide-react";
import type { CIStatusState } from "@/types/github-stats";

// =============================================================================
// CI Status Badge
// =============================================================================

interface CIStatusBadgeProps {
  status: CIStatusState | null;
  size?: "sm" | "md";
  showText?: boolean;
  className?: string;
}

const statusConfig: Record<
  CIStatusState,
  {
    icon: typeof CheckCircle;
    color: string;
    bgColor: string;
    text: string;
  }
> = {
  passing: {
    icon: CheckCircle,
    color: "text-green-400",
    bgColor: "bg-green-500/20",
    text: "Passing",
  },
  failing: {
    icon: XCircle,
    color: "text-red-400",
    bgColor: "bg-red-500/20",
    text: "Failing",
  },
  pending: {
    icon: Clock,
    color: "text-amber-400",
    bgColor: "bg-amber-500/20",
    text: "Pending",
  },
  unknown: {
    icon: HelpCircle,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    text: "Unknown",
  },
};

export function CIStatusBadge({
  status,
  size = "sm",
  showText = false,
  className,
}: CIStatusBadgeProps) {
  if (!status) return null;

  const config = statusConfig[status];
  const Icon = config.icon;
  const iconSize = size === "sm" ? "w-3 h-3" : "w-4 h-4";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full",
        config.bgColor,
        size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1",
        className
      )}
      title={`CI: ${config.text}`}
    >
      <Icon className={cn(iconSize, config.color)} />
      {showText && (
        <span className={cn("text-xs", config.color)}>{config.text}</span>
      )}
    </span>
  );
}

// =============================================================================
// Count Badge
// =============================================================================

interface CountBadgeProps {
  count: number;
  type: "pr" | "issue" | "commit";
  size?: "sm" | "md";
  showZero?: boolean;
  className?: string;
}

const countConfig: Record<
  "pr" | "issue" | "commit",
  {
    icon: typeof GitPullRequest;
    color: string;
    bgColor: string;
    label: string;
  }
> = {
  pr: {
    icon: GitPullRequest,
    color: "text-primary",
    bgColor: "bg-primary/20",
    label: "PRs",
  },
  issue: {
    icon: CircleDot,
    color: "text-primary",
    bgColor: "bg-primary/20",
    label: "Issues",
  },
  commit: {
    icon: CircleDot,
    color: "text-primary",
    bgColor: "bg-primary/20",
    label: "Commits",
  },
};

export function CountBadge({
  count,
  type,
  size = "sm",
  showZero = false,
  className,
}: CountBadgeProps) {
  if (!showZero && count === 0) return null;

  const config = countConfig[type];
  const Icon = config.icon;
  const iconSize = size === "sm" ? "w-3 h-3" : "w-4 h-4";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full",
        config.bgColor,
        size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1",
        className
      )}
      title={`${count} open ${config.label}`}
    >
      <Icon className={cn(iconSize, config.color)} />
      <span className={cn("text-xs font-medium", config.color)}>{count}</span>
    </span>
  );
}

// =============================================================================
// Branch Protection Badge
// =============================================================================

interface BranchProtectionBadgeProps {
  isProtected: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function BranchProtectionBadge({
  isProtected,
  size = "sm",
  className,
}: BranchProtectionBadgeProps) {
  if (!isProtected) return null;

  const iconSize = size === "sm" ? "w-3 h-3" : "w-4 h-4";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-amber-500/20",
        size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1",
        className
      )}
      title="Branch protected"
    >
      <Shield className={cn(iconSize, "text-amber-400")} />
    </span>
  );
}

// =============================================================================
// Change Indicator
// =============================================================================

interface ChangeIndicatorProps {
  count?: number;
  size?: "sm" | "md";
  pulse?: boolean;
  className?: string;
}

export function ChangeIndicator({
  count,
  size = "sm",
  pulse = true,
  className,
}: ChangeIndicatorProps) {
  if (!count || count === 0) return null;

  const dotSize = size === "sm" ? "w-2 h-2" : "w-3 h-3";

  return (
    <span className={cn("relative inline-flex", className)}>
      <span
        className={cn(
          dotSize,
          "rounded-full bg-primary",
          pulse && "animate-pulse"
        )}
      />
      {count > 1 && (
        <span
          className={cn(
            "absolute -top-1 -right-1 text-[8px] font-bold text-primary",
            size === "md" && "text-[10px]"
          )}
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </span>
  );
}

// =============================================================================
// Combined Stats Row
// =============================================================================

interface StatsRowProps {
  prCount?: number;
  issueCount?: number;
  ciStatus?: CIStatusState | null;
  isProtected?: boolean;
  hasChanges?: boolean;
  changeCount?: number;
  compact?: boolean;
  className?: string;
}

export function StatsRow({
  prCount = 0,
  issueCount = 0,
  ciStatus,
  isProtected = false,
  hasChanges = false,
  changeCount = 0,
  compact = false,
  className,
}: StatsRowProps) {
  const size = compact ? "sm" : "md";

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      <CountBadge count={prCount} type="pr" size={size} />
      <CountBadge count={issueCount} type="issue" size={size} />
      {ciStatus && <CIStatusBadge status={ciStatus} size={size} />}
      {isProtected && <BranchProtectionBadge isProtected size={size} />}
      {hasChanges && <ChangeIndicator count={changeCount} size={size} />}
    </div>
  );
}
