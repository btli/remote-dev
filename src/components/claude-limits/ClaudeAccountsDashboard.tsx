"use client";

/**
 * Claude Accounts dashboard. [remote-dev-0yix / remote-dev-n4x4.6 / n4x4.7]
 *
 * cswap-style overview of every Claude ACCOUNT the user owns (an account is one
 * Claude subscription, decoupled from agent profiles): identity, auth health,
 * 5h / 7d usage bars, live reset countdown, status badge, pool memberships, and
 * per-row Verify / Rename / Remove / "Mark available" actions.
 *
 * Driven by a single `GET /api/claude/usage` fetch (→ `data.accounts`); live
 * `profile_limit_changed` updates are overlaid from ProfileContext's
 * `limitStates` map, which is account-keyed (no refetch needed), and a
 * lightweight clock ticks the countdowns. Reachable from Settings → Claude
 * Accounts.
 *
 * A single "Add account" action at the top opens {@link AddAccountDialog} —
 * there is no per-profile login button and no Sync step anywhere.
 *
 * Graceful when data is absent: no accounts → an empty-state card that points
 * at "Add account"; all states "unknown"/available → bars at 0 / muted badges.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { useProfileContext } from "@/contexts/ProfileContext";
import type {
  ClaudeUsageAccount,
  LimitStateBlock,
} from "@/types/claude-limits";
import { ClaudeAccountRow } from "./ClaudeAccountRow";
import { AddAccountDialog } from "./AddAccountDialog";

/** Re-tick the reset countdowns this often (ms). */
const CLOCK_INTERVAL_MS = 30_000;

export function ClaudeAccountsDashboard() {
  const {
    getAccountLimitState,
    markAccountAvailable,
    pools,
    refreshPools,
    refreshAccounts,
  } = useProfileContext();

  const [usage, setUsage] = useState<ClaudeUsageAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/claude/usage");
      if (!response.ok) {
        throw new Error(`Failed to load usage (${response.status})`);
      }
      const data = await response.json();
      setUsage((data.accounts as ClaudeUsageAccount[]) ?? []);
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
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Any mutation here (add / verify / rename / remove) also invalidates the
  // context's account list, which the pool picker reads from.
  const reload = useCallback(() => {
    void load();
    void refreshAccounts();
  }, [load, refreshAccounts]);

  // Resolve the effective limit state for an account: prefer the live cache
  // (updated by the WS event) over the snapshot fetched here, so a
  // `profile_limit_changed` push reflects immediately.
  const resolveLimitState = useCallback(
    (account: ClaudeUsageAccount): LimitStateBlock =>
      getAccountLimitState(account.id) ?? account.limitState,
    [getAccountLimitState]
  );

  // A manual override (markAccountAvailable) updates ProfileContext's
  // `limitStates`; since `getAccountLimitState`'s identity changes with it,
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
            Usage limits and reset times for each Claude account. An account is
            one Claude subscription; limited accounts become available again at
            their reset time.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Reload usage"
            className="text-muted-foreground"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" />
            Add account
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && usage === null ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : usage && usage.length > 0 ? (
        <div className="flex flex-col gap-2">
          {usage.map((account) => (
            <ClaudeAccountRow
              key={account.id}
              account={account}
              limitState={resolveLimitState(account)}
              now={now}
              pools={pools}
              onMarkAvailable={markAccountAvailable}
              onChanged={reload}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Sparkles className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No Claude accounts yet.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Choose{" "}
            <span className="font-medium text-foreground">Add account</span> to
            sign in — or paste a token from{" "}
            <code className="font-mono">claude setup-token</code> if this device
            has no browser.
          </p>
        </div>
      )}

      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={reload}
      />
    </div>
  );
}
