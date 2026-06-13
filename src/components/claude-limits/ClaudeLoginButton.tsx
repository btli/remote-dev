"use client";

/**
 * Per-profile "Log in to Claude" affordance for the Claude Accounts dashboard.
 * [remote-dev-6nu9]
 *
 * Drives the file-based subscription login for a profile:
 *   1. "Log in" → POST { action: "initiate" } seeds the file-based path and
 *      returns the command + steps; we show them (the OAuth/MFA step is the
 *      user's, in a Claude session for this profile).
 *   2. "Sync"   → POST { action: "sync" } reads back the resulting credentials
 *      and upserts the account (email / tier). On success the parent refreshes.
 *
 * Status (logged-in email/tier, expiry, re-login needed) comes from
 * GET /api/profiles/:id/claude-login. Tokens are NEVER fetched or shown.
 *
 * Client component — uses console.error per the logging convention (the
 * structured logger is server-only).
 */

import { useCallback, useEffect, useState } from "react";
import { LogIn, RefreshCw, Loader2, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";

interface ClaudeAuthStatus {
  loggedIn: boolean;
  credentialMode: "file" | "keychain" | null;
  email: string | null;
  organizationName: string | null;
  tier: string | null;
  expiresAt: number | null;
  expired: boolean;
  needsRelogin: boolean;
}

interface LoginInitiation {
  command: string;
  configDir: string;
  instructions: string[];
}

interface ClaudeLoginButtonProps {
  profileId: string;
  /** Called after a successful sync so the parent can refresh account info. */
  onSynced?: () => void;
}

export function ClaudeLoginButton({
  profileId,
  onSynced,
}: ClaudeLoginButtonProps) {
  const [status, setStatus] = useState<ClaudeAuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [initiation, setInitiation] = useState<LoginInitiation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/profiles/${profileId}/claude-login`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus((await res.json()) as ClaudeAuthStatus);
    } catch (err) {
      // Non-fatal: the button still works; just don't show a stale status.
      console.error("Failed to load Claude auth status", err);
    }
  }, [profileId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const initiate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/profiles/${profileId}/claude-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "initiate" }),
      });
      if (!res.ok) throw new Error(`initiate failed (${res.status})`);
      setInitiation((await res.json()) as LoginInitiation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start login");
    } finally {
      setBusy(false);
    }
  }, [profileId]);

  const sync = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/profiles/${profileId}/claude-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (!res.ok) throw new Error(`sync failed (${res.status})`);
      const next = (await res.json()) as ClaudeAuthStatus;
      setStatus(next);
      if (next.loggedIn) {
        setInitiation(null);
        onSynced?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync login");
    } finally {
      setBusy(false);
    }
  }, [profileId, onSynced]);

  const loggedIn = status?.loggedIn ?? false;
  const needsRelogin = status?.needsRelogin ?? false;

  return (
    <div className="flex flex-col items-end gap-1">
      {loggedIn && !needsRelogin ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
          <Check className="w-3 h-3" />
          File-based
        </span>
      ) : needsRelogin ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void initiate()}
          disabled={busy}
          className="h-7 text-xs border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
        >
          {busy ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <AlertTriangle className="w-3 h-3" />
          )}
          Re-login
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void initiate()}
          disabled={busy}
          className="h-7 text-xs"
        >
          {busy ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <LogIn className="w-3 h-3" />
          )}
          Log in to Claude
        </Button>
      )}

      {initiation && (
        <div className="mt-1 w-full max-w-xs rounded-md border border-border bg-card/60 p-2 text-left">
          <p className="text-[11px] text-muted-foreground mb-1">
            In a Claude session for this profile, run:
          </p>
          <code className="block rounded bg-muted/60 px-1.5 py-1 text-[11px] font-mono text-foreground">
            {initiation.command}
          </code>
          <ol className="mt-1 list-decimal pl-4 text-[10px] text-muted-foreground space-y-0.5">
            {initiation.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void sync()}
            disabled={busy}
            className="mt-1 h-6 text-[11px]"
          >
            {busy ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            I&rsquo;ve logged in — Sync
          </Button>
        </div>
      )}

      {status?.expiresAt && loggedIn && !status.expired && (
        <span className="text-[10px] text-muted-foreground/70">
          token valid
        </span>
      )}
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </div>
  );
}
