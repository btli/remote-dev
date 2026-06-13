"use client";

/**
 * Status badge for a Claude profile's usage-limit state. [remote-dev-0yix]
 *
 * Available (emerald) / Limited — resets in Xh Ym (amber) / Unknown (muted).
 * Matches the existing Badge-based styling used across profiles (ProfileCard,
 * ProfileSelector). Pure presentational; pass the limit-state block.
 */

import { CheckCircle2, Clock, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LimitStateBlock } from "@/types/claude-limits";
import { formatLimitStatusLabel } from "./limit-format";

interface LimitStatusBadgeProps {
  state: LimitStateBlock | null;
  /** Live clock for the countdown; defaults to render-time. */
  now?: number;
  className?: string;
}

export function LimitStatusBadge({ state, now, className }: LimitStatusBadgeProps) {
  const status = state?.limitStatus ?? "unknown";
  const label = formatLimitStatusLabel(state, now);

  if (status === "limited") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "bg-amber-500/15 text-amber-400 border-amber-500/30",
          className
        )}
      >
        <Clock className="w-3 h-3" />
        {label}
      </Badge>
    );
  }

  if (status === "available") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
          className
        )}
      >
        <CheckCircle2 className="w-3 h-3" />
        {label}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn("bg-muted/40 text-muted-foreground border-border", className)}
    >
      <HelpCircle className="w-3 h-3" />
      {label}
    </Badge>
  );
}
