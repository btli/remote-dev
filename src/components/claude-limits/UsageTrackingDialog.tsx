"use client";

/**
 * Reusable "Enable usage tracking" dialog for one token-free Claude account.
 *
 * The dialog loads the user's projects, then POSTs `{ projectId, accountId }`
 * to the usage setup route. That route creates an isolated shell session and
 * returns only the safe terminal handoff: session id, command, send status,
 * and instructions. The intentionally returned command may contain the
 * absolute scratch path; the UI never reads or renders separate `scratchDir`
 * metadata or usage OAuth credential material. `useSessionContext()` refreshes
 * and activates the terminal session.
 *
 * Recovery is part of the start gate. Each open first refreshes sessions and
 * keeps Start disabled until SessionContext reconciles the resulting array.
 * An open, account-matched `rdvClaudeUsageSetupSession` is restored instead of
 * creating a duplicate. Because SessionContext currently logs and swallows
 * refresh failures, a short reconciliation fallback lets a user with no
 * recoverable session proceed rather than leaving setup disabled forever.
 *
 * Finish POSTs exactly `{ sessionId }`. `CREDENTIALS_NOT_READY` remains a
 * retryable notice; missing scope and account mismatch return to a fresh-login
 * start after server cleanup. Closing an unfinished setup sends a best-effort
 * abort without delaying the dialog. A fully validated, cleaned, poll-enabled
 * capture closes immediately.
 * Any false or malformed success field remains visible as a terminal completed
 * state, so setup cannot be submitted twice and the user sees why readings may
 * be absent, stale, or awaiting cleanup. Client-side failures use console.error
 * where diagnostic logging helps; the structured server logger is intentionally
 * not imported.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSessionContext } from "@/contexts/SessionContext";
import { apiFetch } from "@/lib/api-fetch";
import type { ClaudeAccountSummary } from "@/types/claude-limits";

const USAGE_SETUP_MARKER = "rdvClaudeUsageSetupSession";
const RECOVERY_RECONCILE_FALLBACK_MS = 100;

interface ProjectOption {
  id: string;
  name: string;
}

interface UsageSetupSession {
  sessionId: string;
  command: string | null;
  commandSent: boolean | null;
  instructions: string[];
  recovered: boolean;
}

interface UsageCaptureCompletion {
  usageValidated: boolean | null;
  cleanupComplete: boolean | null;
  pollEnabled: boolean | null;
}

interface UsageTrackingDialogProps {
  account: ClaudeAccountSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}

async function readError(
  response: Response,
  fallback: string
): Promise<{ message: string; code: string | null }> {
  try {
    const data = (await response.json()) as { error?: unknown; code?: unknown };
    return {
      message: typeof data.error === "string" ? data.error : fallback,
      code: typeof data.code === "string" ? data.code : null,
    };
  } catch {
    return { message: fallback, code: null };
  }
}

function parseSetupSession(data: unknown): UsageSetupSession | null {
  if (!data || typeof data !== "object") return null;
  const candidate = data as Record<string, unknown>;
  if (
    typeof candidate.sessionId !== "string" ||
    (candidate.command !== null && typeof candidate.command !== "string") ||
    (candidate.commandSent !== null &&
      typeof candidate.commandSent !== "boolean") ||
    (candidate.recovered !== undefined &&
      typeof candidate.recovered !== "boolean") ||
    !Array.isArray(candidate.instructions) ||
    !candidate.instructions.every((step) => typeof step === "string")
  ) {
    return null;
  }
  return {
    sessionId: candidate.sessionId,
    command: candidate.command,
    commandSent: candidate.commandSent,
    instructions: candidate.instructions,
    recovered: candidate.recovered === true,
  };
}

function parseCaptureCompletion(data: unknown): UsageCaptureCompletion | null {
  if (!data || typeof data !== "object") return null;
  const candidate = data as Record<string, unknown>;
  const capturedAccount = candidate.account as
    | Record<string, unknown>
    | undefined;
  if (
    !capturedAccount ||
    typeof capturedAccount !== "object" ||
    Array.isArray(capturedAccount) ||
    typeof capturedAccount.id !== "string" ||
    capturedAccount.id.length === 0 ||
    capturedAccount.usageCredential !== true ||
    typeof candidate.usageValidated !== "boolean" ||
    typeof candidate.cleanupComplete !== "boolean" ||
    typeof candidate.pollEnabled !== "boolean"
  ) {
    return null;
  }
  return {
    usageValidated: candidate.usageValidated,
    cleanupComplete: candidate.cleanupComplete,
    pollEnabled: candidate.pollEnabled,
  };
}

async function abortSetupSession(sessionId: string): Promise<void> {
  try {
    const response = await apiFetch("/api/claude-accounts/usage-abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) {
      throw new Error(`usage abort ${response.status}`);
    }
  } catch (caught) {
    console.error("Failed to abort Claude usage setup", caught);
  }
}

export function UsageTrackingDialog({
  account,
  open,
  onOpenChange,
  onCompleted,
}: UsageTrackingDialogProps) {
  const { sessions, refreshSessions, setActiveSession } = useSessionContext();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [setupSession, setSetupSession] =
    useState<UsageSetupSession | null>(null);
  const [completion, setCompletion] =
    useState<UsageCaptureCompletion | null>(null);
  const [busy, setBusy] = useState<"start" | "finish" | "terminal" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryPhase, setRecoveryPhase] = useState<
    "refreshing" | "reconciling" | "ready"
  >("refreshing");
  const currentSessionsRef = useRef(sessions);
  const recoveryBaselineRef = useRef(sessions);
  currentSessionsRef.current = sessions;

  const reset = useCallback(() => {
    setProjects([]);
    setProjectId("");
    setProjectsLoading(true);
    setSetupSession(null);
    setCompletion(null);
    setBusy(null);
    setError(null);
    setNotice(null);
    setRecoveryPhase("refreshing");
  }, []);

  const dismissWithoutAbort = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [onOpenChange, reset]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        onOpenChange(true);
        return;
      }
      const sessionId = !completion ? setupSession?.sessionId : null;
      reset();
      onOpenChange(false);
      if (sessionId) void abortSetupSession(sessionId);
    },
    [completion, onOpenChange, reset, setupSession]
  );

  const recoverUsageSession = useCallback(
    (candidateSessions: typeof sessions) => {
      const existing = candidateSessions.find(
        (session) =>
          session.status !== "closed" &&
          session.status !== "trashed" &&
          session.typeMetadata?.[USAGE_SETUP_MARKER] === true &&
          session.typeMetadata.accountId === account.id
      );
      if (!existing) return;
      setSetupSession({
        sessionId: existing.id,
        command: null,
        commandSent: null,
        instructions: [
          "Complete the Claude sign-in in the terminal.",
          "Return here after sign-in and choose Finish.",
        ],
        recovered: true,
      });
    },
    [account.id]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProjectsLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await apiFetch("/api/projects");
        if (!response.ok) throw new Error(`projects ${response.status}`);
        const data = (await response.json()) as { projects?: ProjectOption[] };
        if (cancelled) return;
        const list = Array.isArray(data.projects) ? data.projects : [];
        setProjects(list);
        setProjectId((current) => current || list[0]?.id || "");
      } catch (caught) {
        if (cancelled) return;
        console.error("Failed to load projects for usage tracking", caught);
        setProjects([]);
        setProjectId("");
        setError("Could not load projects. Try again.");
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account.id, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let fallbackId: ReturnType<typeof setTimeout> | null = null;
    recoveryBaselineRef.current = currentSessionsRef.current;
    setRecoveryPhase("refreshing");
    void (async () => {
      try {
        await refreshSessions();
      } catch (caught) {
        // SessionContext currently handles and swallows its fetch failures.
        // Keep this guard for injected callers and future API changes.
        console.error("Failed to refresh usage setup sessions", caught);
      }
      if (cancelled) return;
      setRecoveryPhase("reconciling");
      // A successful refresh dispatches a new sessions array. If the context
      // swallowed a fetch failure, there is no reconciliation signal, so allow
      // a new setup after a short grace period instead of blocking forever.
      fallbackId = setTimeout(() => {
        if (cancelled) return;
        recoverUsageSession(currentSessionsRef.current);
        setRecoveryPhase("ready");
      }, RECOVERY_RECONCILE_FALLBACK_MS);
    })();
    return () => {
      cancelled = true;
      if (fallbackId !== null) clearTimeout(fallbackId);
    };
  }, [account.id, open, recoverUsageSession, refreshSessions]);

  useEffect(() => {
    if (
      !open ||
      setupSession ||
      recoveryPhase !== "reconciling" ||
      sessions === recoveryBaselineRef.current
    )
      return;
    recoverUsageSession(sessions);
    setRecoveryPhase("ready");
  }, [open, recoverUsageSession, recoveryPhase, sessions, setupSession]);

  async function startSetupSession() {
    if (!projectId || recoveryPhase !== "ready") return;
    setBusy("start");
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(
        "/api/claude-accounts/usage-setup-session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, accountId: account.id }),
        }
      );
      if (!response.ok) {
        const failure = await readError(
          response,
          "Could not start usage tracking. Try again."
        );
        setError(failure.message);
        return;
      }
      const started = parseSetupSession(await response.json());
      if (!started) {
        setError("Could not start usage tracking. Try again.");
        return;
      }
      setSetupSession(started);
      await refreshSessions();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not start usage tracking. Try again."
      );
    } finally {
      setBusy(null);
    }
  }

  async function openTerminalSession() {
    if (!setupSession) return;
    setBusy("terminal");
    setError(null);
    try {
      await refreshSessions();
      setActiveSession(setupSession.sessionId);
      dismissWithoutAbort();
    } catch (caught) {
      console.error("Failed to open usage setup session", caught);
      setError("Could not open the terminal session. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function finishSetupSession() {
    if (!setupSession) return;
    setBusy("finish");
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch("/api/claude-accounts/usage-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: setupSession.sessionId }),
      });
      if (!response.ok) {
        const failure = await readError(
          response,
          "Could not finish usage tracking. Try again."
        );
        if (failure.code === "CREDENTIALS_NOT_READY") {
          setNotice(
            "Finish the Claude sign-in in the terminal, then try Finish again."
          );
        } else if (failure.code === "MISSING_SCOPE") {
          setError(
            "Usage permission was not granted. Start a new Claude usage sign-in and grant usage permission."
          );
          setSetupSession(null);
          try {
            await refreshSessions();
          } catch (caught) {
            console.error(
              "Failed to refresh sessions after terminal usage capture failure",
              caught
            );
          }
        } else if (failure.code === "ACCOUNT_MISMATCH") {
          setError(
            "A different Claude account was used and was not attached. Start a new sign-in with the account shown here."
          );
          setSetupSession(null);
          try {
            await refreshSessions();
          } catch (caught) {
            console.error(
              "Failed to refresh sessions after terminal usage capture failure",
              caught
            );
          }
        } else {
          setError(failure.message);
        }
        return;
      }

      let responseBody: unknown = null;
      try {
        responseBody = await response.json();
      } catch (caught) {
        console.error("Failed to read usage capture response", caught);
      }
      const captured = parseCaptureCompletion(responseBody);
      const nextCompletion = captured ?? {
        usageValidated: null,
        cleanupComplete: null,
        pollEnabled: null,
      };
      onCompleted();
      try {
        await refreshSessions();
      } catch (caught) {
        console.error("Failed to refresh sessions after usage capture", caught);
      }
      if (
        captured?.usageValidated &&
        captured.cleanupComplete &&
        captured.pollEnabled
      ) {
        dismissWithoutAbort();
      } else {
        setCompletion(nextCompletion);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not finish usage tracking. Try again."
      );
    } finally {
      setBusy(null);
    }
  }

  const label = account.alias ?? account.emailAddress ?? "this Claude account";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {completion ? "Usage tracking enabled" : "Enable usage tracking"}
          </DialogTitle>
          <DialogDescription>
            {completion ? (
              <>Usage credentials for {label} were saved.</>
            ) : (
              <>
                Sign in to {label} separately to enable the 5h and 7d usage
                bars.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {completion ? (
          <div
            role="status"
            aria-live="polite"
            className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm"
          >
            {completion.usageValidated === null ||
            completion.cleanupComplete === null ||
            completion.pollEnabled === null ? (
              <p>
                Credentials were saved, but Remote Dev could not confirm
                validation, cleanup, or polling status. Check the account after
                closing this dialog.
              </p>
            ) : (
              <>
                <p className="font-medium">Usage tracking is enabled.</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {!completion.usageValidated && (
                    <li>
                      Credentials were saved, but no usage reading is available
                      yet.
                    </li>
                  )}
                  {!completion.cleanupComplete && (
                    <li>
                      Terminal or credential cleanup did not finish. A
                      credential or sign-in scrollback may remain. Restart
                      Remote Dev to retry retained credential cleanup.
                    </li>
                  )}
                  {!completion.pollEnabled && (
                    <li>
                      Automatic usage refresh is disabled. Readings will go
                      stale until{" "}
                      <code className="font-mono text-foreground">
                        RDV_CLAUDE_USAGE_POLL_ENABLED=true
                      </code>{" "}
                      is set.
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>
        ) : setupSession ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                {setupSession.recovered
                  ? "An existing usage sign-in session is ready."
                  : setupSession.commandSent
                    ? "The sign-in command is running in the terminal."
                    : "Run this command in the terminal session."}
              </p>
              {setupSession.command && (
                <code className="block rounded bg-muted/60 px-2 py-1 text-[11px] font-mono text-foreground break-all">
                  {setupSession.command}
                </code>
              )}
              <ol className="list-decimal pl-4 text-[11px] text-muted-foreground space-y-0.5">
                {setupSession.instructions.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
        ) : projectsLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading projects
          </div>
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create a project before starting usage sign-in.
          </p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="usage-tracking-project">Run the sign-in in</Label>
            <Select
              value={projectId}
              onValueChange={setProjectId}
              disabled={busy !== null}
            >
              <SelectTrigger
                id="usage-tracking-project"
                className="bg-card/50 border-border"
              >
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
        )}

        {notice && (
          <p role="status" className="text-sm text-amber-400">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant={completion ? "default" : "ghost"}
            onClick={() => handleOpenChange(false)}
            disabled={busy !== null}
          >
            {completion ? "Close" : "Cancel"}
          </Button>
          {completion ? null : setupSession ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => void openTerminalSession()}
                disabled={busy !== null}
              >
                {busy === "terminal" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TerminalIcon className="h-4 w-4" />
                )}
                Open terminal session
              </Button>
              <Button
                type="button"
                onClick={() => void finishSetupSession()}
                disabled={busy !== null}
              >
                {busy === "finish" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Finish
              </Button>
            </>
          ) : projects.length > 0 && !projectsLoading ? (
            <Button
              type="button"
              onClick={() => void startSetupSession()}
              disabled={
                busy !== null || !projectId || recoveryPhase !== "ready"
              }
            >
              {(busy === "start" || recoveryPhase !== "ready") && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Start usage sign-in
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
