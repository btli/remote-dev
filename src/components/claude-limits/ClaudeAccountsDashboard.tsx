"use client";

/**
 * Claude Accounts dashboard. [remote-dev-0yix]
 *
 * cswap-style overview of every claude-capable profile: account kind, 5h / 7d
 * usage bars, live reset countdown, status badge, pool memberships, and a
 * per-row "Mark available" override. Driven by a single `GET /api/claude/usage`
 * fetch; live `profile_limit_changed` updates are overlaid from ProfileContext's
 * `limitStates` map (no refetch needed), and a lightweight clock ticks the
 * countdowns. Reachable from Settings → Claude Accounts.
 *
 * Graceful when data is absent: no claude profiles → an empty-state card; all
 * states "unknown"/available → bars at 0 / muted badges.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { useProfileContext } from "@/contexts/ProfileContext";
import type {
  ClaudeUsageProfile,
  LimitStateBlock,
} from "@/types/claude-limits";
import { ClaudeAccountRow } from "./ClaudeAccountRow";

/** Re-tick the reset countdowns this often (ms). */
const CLOCK_INTERVAL_MS = 30_000;

export function ClaudeAccountsDashboard() {
  const { getLimitState, markProfileAvailable, pools, refreshPools } =
    useProfileContext();

  const [usage, setUsage] = useState<ClaudeUsageProfile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/claude/usage");
      if (!response.ok) {
        throw new Error(`Failed to load usage (${response.status})`);
      }
      const data = await response.json();
      setUsage((data.profiles as ClaudeUsageProfile[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + ensure pool names are available for membership labels.
  useEffect(() => {
    void load();
    void refreshPools();
  }, [load, refreshPools]);

  // Live clock for countdowns (cheap; only re-renders this subtree).
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    intervalRef.current = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Resolve the effective limit state for a profile: prefer the live cache
  // (seeded from the same payload + updated by the WS event) over the snapshot
  // fetched here, so a `profile_limit_changed` push reflects immediately.
  const resolveLimitState = useCallback(
    (profile: ClaudeUsageProfile): LimitStateBlock =>
      getLimitState(profile.id) ?? profile.limitState,
    [getLimitState]
  );

  // A manual override (markProfileAvailable) updates ProfileContext's
  // `limitStates`; since `getLimitState`'s identity changes with it,
  // `resolveLimitState` re-runs and the row re-renders with the cleared state.

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Claude Accounts
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Usage limits and reset times for each Claude profile. A profile maps
            to one Claude account; limited profiles become available again at
            their reset time.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="text-muted-foreground"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && usage === null ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : usage && usage.length > 0 ? (
        <div className="flex flex-col gap-2">
          {usage.map((profile) => (
            <ClaudeAccountRow
              key={profile.id}
              profile={profile}
              limitState={resolveLimitState(profile)}
              now={now}
              pools={pools}
              onMarkAvailable={markProfileAvailable}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Sparkles className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No Claude profiles yet.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Create a profile with the Claude provider in{" "}
            <span className="font-medium text-foreground">Settings → Profiles</span>{" "}
            to track its usage limits here.
          </p>
        </div>
      )}
    </div>
  );
}
