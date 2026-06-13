"use client";

/**
 * One row of the Claude Accounts dashboard. [remote-dev-0yix]
 *
 * cswap-style: profile name + identity, account kind, 5h / 7d utilization bars,
 * a live reset countdown, a status badge, pool memberships, and (for a limited
 * profile) a "Mark available" manual-override action.
 *
 * Presentational — the parent owns data + the live clock and passes a resolved
 * limit-state (already overlaid with any live WS update).
 */

import { useState } from "react";
import { Loader2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type {
  ClaudeUsageProfile,
  LimitStateBlock,
  ClaudeAccountKind,
  ClaudePoolSummary,
} from "@/types/claude-limits";
import { LimitStatusBadge } from "./LimitStatusBadge";
import { formatPct, formatResetCountdown, isLimitedNow } from "./limit-format";

const ACCOUNT_KIND_LABEL: Record<ClaudeAccountKind, string> = {
  subscription: "Subscription",
  api_key: "API key",
};

interface ClaudeAccountRowProps {
  profile: ClaudeUsageProfile;
  /** Effective limit state (fetched value overlaid with any live WS update). */
  limitState: LimitStateBlock;
  /** Live clock (epoch-ms) so the countdown ticks. */
  now: number;
  /** All of the user's pools, to resolve membership ids → names. */
  pools: ClaudePoolSummary[];
  onMarkAvailable: (profileId: string) => Promise<void>;
}

/** A small labelled utilization bar (5h / 7d window). */
function UsageBar({ label, pct }: { label: string; pct: number | null }) {
  const value = pct ?? 0;
  const high = value >= 90;
  const mid = value >= 70 && value < 90;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span
          className={cn(
            "tabular-nums",
            high && "text-amber-400",
            pct === null && "text-muted-foreground/60"
          )}
        >
          {formatPct(pct)}
        </span>
      </div>
      <Progress
        value={value}
        className={cn(
          high
            ? "[&>div]:bg-amber-500"
            : mid
              ? "[&>div]:bg-yellow-500"
              : "[&>div]:bg-emerald-500"
        )}
      />
    </div>
  );
}

export function ClaudeAccountRow({
  profile,
  limitState,
  now,
  pools,
  onMarkAvailable,
}: ClaudeAccountRowProps) {
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limited = isLimitedNow(limitState);
  const countdown = formatResetCountdown(limitState.effectiveResetAt, now);

  const poolNames = profile.pools
    .map((id) => pools.find((p) => p.id === id)?.name ?? null)
    .filter((n): n is string => !!n);

  async function handleMark() {
    setMarking(true);
    setError(null);
    try {
      await onMarkAvailable(profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setMarking(false);
    }
  }

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1.6fr)_minmax(0,2.4fr)_minmax(0,1.6fr)_auto] items-center gap-4 rounded-lg border p-3",
        limited ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card/30"
      )}
    >
      {/* Identity */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground truncate">
            {profile.name}
          </span>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 bg-violet-500/10 text-violet-300 border-violet-500/30 shrink-0"
          >
            {ACCOUNT_KIND_LABEL[profile.accountKind]}
          </Badge>
        </div>
        {(profile.emailAddress || profile.organizationName) && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {profile.emailAddress}
            {profile.emailAddress && profile.organizationName ? " · " : ""}
            {profile.organizationName}
          </p>
        )}
        {poolNames.length > 0 && (
          <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/80">
            <Users className="w-3 h-3 shrink-0" />
            <span className="truncate">{poolNames.join(", ")}</span>
          </div>
        )}
      </div>

      {/* Usage bars */}
      <div className="grid grid-cols-2 gap-3">
        <UsageBar label="5h" pct={limitState.window5hPct} />
        <UsageBar label="7d" pct={limitState.window7dPct} />
      </div>

      {/* Status + countdown */}
      <div className="flex flex-col gap-1 min-w-0">
        <LimitStatusBadge state={limitState} now={now} />
        {limited && countdown && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            resets in {countdown}
          </span>
        )}
      </div>

      {/* Action */}
      <div className="flex flex-col items-end gap-1">
        {limited ? (
          <Button
            size="sm"
            variant="outline"
            onClick={handleMark}
            disabled={marking}
            className="h-7 text-xs border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
          >
            {marking ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              "Mark available"
            )}
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">—</span>
        )}
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    </div>
  );
}
