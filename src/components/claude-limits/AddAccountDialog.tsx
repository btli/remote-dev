"use client";

/**
 * "Add Claude account" dialog. [remote-dev-n4x4.7]
 *
 * The single onboarding surface for a Claude ACCOUNT, replacing the old
 * three-step flow (create a profile → a per-profile "Log in" button that only
 * printed copy-paste instructions → a "Sync" button that read a credentials
 * file which never exists on macOS). There is NO Sync step anywhere: identity
 * is read server-side from `claude auth status --json` at capture time.
 *
 * Two paths:
 *   1. "Sign in here" (default when the user has at least one project) —
 *      POST /api/claude-accounts/setup-session launches a real terminal
 *      session running `claude setup-token`. The user completes the browser
 *      sign-in, then presses Finish, which POSTs /api/claude-accounts/capture.
 *      A 409 `TOKEN_NOT_READY` keeps the dialog open with a retry; a 409
 *      `TOKEN_TRUNCATED` (the pane clipped the printed token) surfaces the
 *      truncation diagnosis — the setup session stays open server-side so the
 *      user can widen the terminal, re-run, or fall back to the paste flow.
 *   2. "Paste a token" (always available; the remote / PWA fallback) —
 *      POST /api/claude-accounts with `{ token, alias? }`. A 400
 *      `INVALID_TOKEN_FORMAT` or `TOKEN_TRUNCATED` is surfaced verbatim.
 *
 * Either path can succeed at STORING the token yet learn it is dead: the save
 * response carries `tokenValid: false` + `tokenError` when Anthropic 401'd the
 * token at save time [remote-dev-307w]. The dialog then shows that diagnosis
 * (and refreshes the list — the unhealthy row exists) instead of closing as if
 * the account were signed in.
 *
 * The token is only ever held in a transient input value that is cleared as
 * soon as the request resolves: it is never logged, never placed in a URL, and
 * never written to persisted state.
 *
 * Both successful save routes also return the token-free account projection.
 * A healthy account without usage tracking remains in this dialog for one
 * optional second step: offer the separate usage sign-in that powers the 5h /
 * 7d bars. "Not now" completes onboarding immediately. "Enable now" closes and
 * resets Add Account before handing the selected account to the dashboard, so
 * the reusable UsageTrackingDialog is never nested inside this modal. Invalid
 * or unhealthy saves retain their existing diagnosis, and an account that
 * already has usage tracking skips the offer.
 *
 * Client component — uses console.error per the logging convention (the
 * structured logger is server-only).
 */

import { useCallback, useEffect, useState } from "react";
import {
  ClipboardPaste,
  Loader2,
  Plus,
  Terminal as TerminalIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { ClaudeAccountSummary } from "@/types/claude-limits";

type AddMode = "session" | "token";

interface ProjectOption {
  id: string;
  name: string;
}

interface SetupSession {
  sessionId: string;
  command: string;
  commandSent: boolean;
  instructions: string[];
}

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after an account was created or updated so the parent can refetch. */
  onAdded: () => void;
  /** Called after this dialog closes when the fresh account chooses step two. */
  onEnableUsage: (account: ClaudeAccountSummary) => void;
}

/** Read `{ error, code }` off a failed response without throwing on non-JSON. */
async function readError(
  response: Response,
  fallback: string
): Promise<{ message: string; code: string | null }> {
  try {
    const data = (await response.json()) as { error?: string; code?: string };
    return { message: data.error || fallback, code: data.code ?? null };
  } catch {
    return { message: fallback, code: null };
  }
}

/** The slice of a successful save response the dialog acts on. */
interface SaveOutcome {
  /** Token-free account projection returned by both save routes. */
  account?: ClaudeAccountSummary;
  /** False = Anthropic 401'd the token at save time. Null = indeterminate. */
  tokenValid?: boolean | null;
  /** Human-readable diagnosis, present exactly when `tokenValid` is false. */
  tokenError?: string;
}

export function AddAccountDialog({
  open,
  onOpenChange,
  onAdded,
  onEnableUsage,
}: AddAccountDialogProps) {
  const [mode, setMode] = useState<AddMode>("session");
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingUsageAccount, setPendingUsageAccount] =
    useState<ClaudeAccountSummary | null>(null);

  // "Sign in here" path.
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [setupSession, setSetupSession] = useState<SetupSession | null>(null);

  // "Paste a token" path. Transient only — cleared on submit and on close.
  const [token, setToken] = useState("");

  const reset = useCallback(() => {
    setAlias("");
    setToken("");
    setError(null);
    setNotice(null);
    setSetupSession(null);
    setPendingUsageAccount(null);
    setBusy(false);
  }, []);

  // Load the project list for the setup-session path. A user with no projects
  // can only use the paste-a-token fallback, so default to that mode.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch("/api/projects");
        if (!response.ok) throw new Error(`projects ${response.status}`);
        const data = await response.json();
        if (cancelled) return;
        const list = (data.projects as ProjectOption[]) ?? [];
        setProjects(list);
        setProjectId((prev) => prev || (list[0]?.id ?? ""));
        if (list.length === 0) setMode("token");
      } catch (err) {
        if (cancelled) return;
        // Non-fatal: the paste-a-token path needs no project.
        console.error("Failed to load projects for Claude account setup", err);
        setProjects([]);
        setMode("token");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset]
  );

  function handleSaveOutcome(
    outcome: SaveOutcome,
    rejectedFallback: string
  ) {
    onAdded();
    if (
      outcome.tokenValid === false ||
      outcome.account?.authHealthy === false
    ) {
      setError(outcome.tokenError ?? rejectedFallback);
      return;
    }
    if (
      outcome.account?.authHealthy &&
      !outcome.account.usageCredential
    ) {
      setPendingUsageAccount(outcome.account);
      return;
    }
    handleOpenChange(false);
  }

  function enableUsageNow() {
    if (!pendingUsageAccount) return;
    const account = pendingUsageAccount;
    // Close and reset this dialog before the dashboard opens the next one.
    handleOpenChange(false);
    onEnableUsage(account);
  }

  async function startSetupSession() {
    if (!projectId) {
      setError("Pick a project to run the sign-in session in.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch("/api/claude-accounts/setup-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!response.ok) {
        const { message } = await readError(
          response,
          "Failed to start the sign-in session"
        );
        setError(message);
        return;
      }
      setSetupSession((await response.json()) as SetupSession);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start the sign-in session"
      );
    } finally {
      setBusy(false);
    }
  }

  async function finishSetupSession() {
    if (!setupSession) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch("/api/claude-accounts/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: setupSession.sessionId,
          ...(alias.trim() ? { alias: alias.trim() } : {}),
        }),
      });
      if (!response.ok) {
        const { message, code } = await readError(
          response,
          "Failed to capture the account"
        );
        if (code === "TOKEN_NOT_READY") {
          // Expected while the browser sign-in is still in flight: keep the
          // dialog open so the user can retry once the CLI prints the token.
          setNotice(message);
          return;
        }
        setError(message);
        return;
      }
      const outcome = (await response.json()) as SaveOutcome;
      handleSaveOutcome(outcome, "Claude did not report a healthy sign-in.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to capture the account"
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitToken() {
    const value = token.trim();
    if (!value) {
      setError("Paste the token printed by `claude setup-token`.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch("/api/claude-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: value,
          ...(alias.trim() ? { alias: alias.trim() } : {}),
        }),
      });
      // Drop the token from component state the moment it is no longer needed.
      setToken("");
      if (!response.ok) {
        const { message } = await readError(
          response,
          "Failed to store the account token"
        );
        setError(message);
        return;
      }
      const outcome = (await response.json()) as SaveOutcome;
      handleSaveOutcome(outcome, "Claude did not report a healthy sign-in.");
    } catch (err) {
      setToken("");
      setError(
        err instanceof Error ? err.message : "Failed to store the account token"
      );
    } finally {
      setBusy(false);
    }
  }

  const canUseSession = projects.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {pendingUsageAccount
              ? "Enable usage tracking now?"
              : "Add Claude account"}
          </DialogTitle>
          <DialogDescription>
            {pendingUsageAccount ? (
              <>
                A separate Claude sign-in enables the 5h and 7d usage bars. You
                can do this later.
              </>
            ) : (
              <>
                An account is one Claude subscription. Sessions pick an account
                at launch; the token is stored encrypted and never shown again.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!pendingUsageAccount && (
          <>
            {/* Path picker */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!canUseSession}
                onClick={() => {
                  setMode("session");
                  setError(null);
                  setNotice(null);
                }}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-left transition-all",
                  mode === "session"
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card/40 hover:border-primary/50",
                  !canUseSession && "opacity-50 cursor-not-allowed"
                )}
              >
                <TerminalIcon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    Sign in here
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Runs the sign-in in a terminal session.
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("token");
                  setError(null);
                  setNotice(null);
                }}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-left transition-all",
                  mode === "token"
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card/40 hover:border-primary/50"
                )}
              >
                <ClipboardPaste className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    Paste a token
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    For remote or mobile use, with no local browser.
                  </span>
                </span>
              </button>
            </div>

            {/* Shared: optional label */}
            <div className="space-y-2">
              <Label htmlFor="claude-account-alias">Label (optional)</Label>
              <Input
                id="claude-account-alias"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. Work Max"
                className="bg-card/50 border-border"
              />
            </div>

            {mode === "session" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Run the sign-in in</Label>
                  <Select
                    value={projectId}
                    onValueChange={setProjectId}
                    disabled={busy || setupSession !== null}
                  >
                    <SelectTrigger className="bg-card/50 border-border">
                      <SelectValue placeholder="Pick a project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {setupSession && (
                  <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      A session was opened
                      {setupSession.commandSent
                        ? " and is already running:"
                        : ". Run this in it:"}
                    </p>
                    <code className="block rounded bg-muted/60 px-2 py-1 text-[11px] font-mono text-foreground">
                      {setupSession.command}
                    </code>
                    <ol className="list-decimal pl-4 text-[11px] text-muted-foreground space-y-0.5">
                      {setupSession.instructions.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="claude-account-token">Token</Label>
                <Input
                  id="claude-account-token"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="sk-ant-oat…"
                  className="bg-card/50 border-border font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Run <code className="font-mono">claude setup-token</code> on
                  any machine with a browser and paste the value it prints.
                </p>
              </div>
            )}

            {notice && <p className="text-sm text-amber-400">{notice}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        )}

        <DialogFooter>
          {pendingUsageAccount ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
              >
                Not now
              </Button>
              <Button type="button" onClick={enableUsageNow}>
                Enable now
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              {mode === "session" ? (
                setupSession ? (
                  <Button
                    type="button"
                    onClick={() => void finishSetupSession()}
                    disabled={busy}
                  >
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    Finish
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => void startSetupSession()}
                    disabled={busy || !projectId}
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    Start sign-in
                  </Button>
                )
              ) : (
                <Button
                  type="button"
                  onClick={() => void submitToken()}
                  disabled={busy || !token.trim()}
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Add account
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
