"use client";

/**
 * One row of the Claude Accounts dashboard. [remote-dev-0yix / remote-dev-n4x4.6]
 *
 * Renders an ACCOUNT (a Claude subscription), not an agent profile: label
 * (alias → email → "Unnamed account"), email, organization, rate-limit tier,
 * auth health (`authHealthy` + `authMethod` + a relative `lastVerifiedAt`),
 * 5h / 7d utilization bars, a live reset countdown, a status badge, and pool
 * memberships.
 *
 * Actions: Verify (re-read identity via `claude auth status --json`), Rename
 * (PATCH the alias), Remove (DELETE, behind a confirm), plus the "Mark
 * available" manual limit override for a limited account. Tokens are never
 * displayed or requested here — the account is token-free on the wire
 * (`hasToken` only).
 *
 * Presentational-ish — the parent owns the usage fetch, the live clock, and
 * the limit-state overlay; this row owns only its own action requests.
 *
 * Client component — uses console.error per the logging convention (the
 * structured logger is server-only).
 */

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type {
  ClaudeUsageAccount,
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
  account: ClaudeUsageAccount;
  /** Effective limit state (fetched value overlaid with any live WS update). */
  limitState: LimitStateBlock;
  /** Live clock (epoch-ms) so the countdown ticks. */
  now: number;
  /** All of the user's pools, to resolve membership ids → names. */
  pools: ClaudePoolSummary[];
  onMarkAvailable: (accountId: string) => Promise<void>;
  /** Called after verify / rename / remove so the parent can refetch. */
  onChanged: () => void;
}

/** Display label for an account: alias, else email, else a neutral fallback. */
export function accountLabel(account: {
  alias: string | null;
  emailAddress: string | null;
}): string {
  return account.alias ?? account.emailAddress ?? "Unnamed account";
}

/** "just now" / "5m ago" / "3h ago" / "2d ago"; null when never verified. */
function formatRelativeAge(atMs: number | null, now: number): string | null {
  if (atMs === null || !Number.isFinite(atMs)) return null;
  const deltaMs = now - atMs;
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** A small labelled utilization bar (5h / 7d window). */
function UsageBar({ label, pct }: { label: string; pct: number | null }) {
  const value = pct ?? 0;
  let barClass = "[&>div]:bg-emerald-500";
  if (value >= 90) barClass = "[&>div]:bg-amber-500";
  else if (value >= 70) barClass = "[&>div]:bg-yellow-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span
          className={cn(
            "tabular-nums",
            value >= 90 && "text-amber-400",
            pct === null && "text-muted-foreground/60"
          )}
        >
          {formatPct(pct)}
        </span>
      </div>
      <Progress value={value} className={barClass} />
    </div>
  );
}

export function ClaudeAccountRow({
  account,
  limitState,
  now,
  pools,
  onMarkAvailable,
  onChanged,
}: ClaudeAccountRowProps) {
  const [marking, setMarking] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftAlias, setDraftAlias] = useState("");
  const [savingAlias, setSavingAlias] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limited = isLimitedNow(limitState);
  const countdown = formatResetCountdown(limitState.effectiveResetAt, now);
  const verifiedAge = formatRelativeAge(account.lastVerifiedAt, now);

  const poolNames = account.pools
    .map((id) => pools.find((p) => p.id === id)?.name ?? null)
    .filter((n): n is string => !!n);

  async function handleMark() {
    setMarking(true);
    setError(null);
    try {
      await onMarkAvailable(account.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setMarking(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/claude-accounts/${account.id}/verify`,
        { method: "POST" }
      );
      if (!response.ok) throw new Error(`Verify failed (${response.status})`);
      const outcome = (await response.json()) as {
        /** False = Anthropic 401'd the stored token [remote-dev-307w]. */
        tokenValid?: boolean | null;
        /** Human-readable diagnosis, present exactly when tokenValid is false. */
        tokenError?: string;
      };
      // Still refresh (the badge flips to unhealthy), but ALSO surface the
      // diagnosis so a dead account explains itself instead of just dimming.
      onChanged();
      if (outcome.tokenValid === false) {
        setError(
          outcome.tokenError ?? "Anthropic rejected this account's stored token."
        );
      }
    } catch (err) {
      console.error("Failed to verify Claude account", err);
      setError(err instanceof Error ? err.message : "Verify failed");
    } finally {
      setVerifying(false);
    }
  }

  async function handleSaveAlias() {
    setSavingAlias(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/claude-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: draftAlias.trim() || null }),
      });
      if (!response.ok) throw new Error(`Rename failed (${response.status})`);
      setRenaming(false);
      onChanged();
    } catch (err) {
      console.error("Failed to rename Claude account", err);
      setError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setSavingAlias(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/claude-accounts/${account.id}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Remove failed (${response.status})`);
      }
      setConfirmRemove(false);
      onChanged();
    } catch (err) {
      console.error("Failed to remove Claude account", err);
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  const label = accountLabel(account);

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1.6fr)_minmax(0,2.4fr)_minmax(0,1.6fr)_auto] items-center gap-4 rounded-lg border p-3",
        limited ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card/30"
      )}
    >
      {/* Identity */}
      <div className="min-w-0">
        {renaming ? (
          <div className="flex items-center gap-1">
            <Input
              value={draftAlias}
              autoFocus
              onChange={(e) => setDraftAlias(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSaveAlias();
                } else if (e.key === "Escape") {
                  setRenaming(false);
                }
              }}
              placeholder={account.emailAddress ?? "Label"}
              className="h-7 bg-card/50 border-border text-sm"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => void handleSaveAlias()}
              disabled={savingAlias}
              aria-label="Save label"
              className="h-7 w-7 shrink-0"
            >
              {savingAlias ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setRenaming(false)}
              aria-label="Cancel rename"
              className="h-7 w-7 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">{label}</span>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 bg-violet-500/10 text-violet-300 border-violet-500/30 shrink-0"
            >
              {ACCOUNT_KIND_LABEL[account.accountKind]}
            </Badge>
            {account.rateLimitTier && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 bg-muted/40 text-muted-foreground border-border shrink-0"
              >
                {account.rateLimitTier}
              </Badge>
            )}
          </div>
        )}
        {(account.emailAddress || account.organizationName) && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {account.emailAddress}
            {account.emailAddress && account.organizationName ? " · " : ""}
            {account.organizationName}
          </p>
        )}
        <div className="flex items-center gap-1 mt-1 text-[10px]">
          {account.authHealthy ? (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <Check className="w-3 h-3 shrink-0" />
              Signed in
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Not signed in
            </span>
          )}
          <span className="text-muted-foreground/70 truncate">
            {account.authMethod ? `· ${account.authMethod}` : ""}
            {verifiedAge ? ` · checked ${verifiedAge}` : " · never checked"}
          </span>
        </div>
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

      {/* Actions */}
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => void handleVerify()}
            disabled={verifying}
            title="Verify — re-read this account's identity"
            aria-label="Verify account"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            {verifying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => {
              setDraftAlias(account.alias ?? "");
              setRenaming(true);
            }}
            title="Rename"
            aria-label="Rename account"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setConfirmRemove(true)}
            title="Remove"
            aria-label="Remove account"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        {limited && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleMark()}
            disabled={marking}
            className="h-7 text-xs border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
          >
            {marking ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              "Mark available"
            )}
          </Button>
        )}
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              The stored token, usage-limit history, and pool memberships for
              this account are deleted. Projects pinned to it fall back to their
              default. You can add the account again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleRemove();
              }}
              disabled={removing}
            >
              {removing && <Loader2 className="w-4 h-4 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
