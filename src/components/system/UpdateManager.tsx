"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Loader2,
  Download,
  CheckCircle2,
  AlertCircle,
  ArrowUpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import type { UpdateStatusResponse } from "@/interface/presenters/UpdatePresenter";

/**
 * UpdateManager - Self-contained component for checking and applying updates.
 *
 * Displays current version, latest available version, and provides
 * "Check Now" and "Update & Restart" actions.
 */
export function UpdateManager() {
  const [status, setStatus] = useState<UpdateStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/system/update");
      if (!res.ok) throw new Error("Failed to fetch update status");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("Failed to load update status:", err);
      setError("Failed to check update status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleCheck = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/system/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check" }),
      });
      if (!res.ok) throw new Error("Failed to check for updates");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("Failed to check for updates:", err);
      setError("Failed to check for updates");
    } finally {
      setChecking(false);
    }
  }, []);

  const handleApply = useCallback(async () => {
    setApplying(true);
    setError(null);
    setShowUpdateDialog(false);
    try {
      const res = await fetch("/api/system/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to apply update");
      }
      const data = await res.json();
      setApplyResult(
        `Update to v${data.version} applied. The service will restart shortly.`
      );
    } catch (err) {
      console.error("Failed to apply update:", err);
      setError(err instanceof Error ? err.message : "Failed to apply update");
    } finally {
      setApplying(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading update status...
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-foreground">Software Updates</Label>
            {status && (
              <span className="text-xs text-muted-foreground">
                v{status.currentVersion}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCheck}
            disabled={checking || applying}
            title="Check for updates"
          >
            <RefreshCw
              className={`w-4 h-4 ${checking ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Apply result */}
        {applyResult && (
          <div className="text-sm text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {applyResult}
          </div>
        )}

        {/* Status content */}
        {status && (
          <>
            {/* Version info card */}
            <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Current version
                </span>
                <span className="text-sm font-mono text-foreground">
                  v{status.currentVersion}
                </span>
              </div>
              {status.latestVersion && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Latest version
                  </span>
                  <span className="text-sm font-mono text-foreground">
                    v{status.latestVersion}
                  </span>
                </div>
              )}
              {status.deploy && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Build
                    </span>
                    <span className="text-sm font-mono text-muted-foreground">
                      {status.deploy.activeCommit.slice(0, 7)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Deployed
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatRelativeTime(status.deploy.deployedAt)}
                    </span>
                  </div>
                </>
              )}
              {status.lastChecked && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Last checked
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatRelativeTime(status.lastChecked)}
                  </span>
                </div>
              )}
            </div>

            {/* Update available */}
            {status.updateAvailable && status.latestVersion && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <ArrowUpCircle className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium text-foreground">
                    v{status.latestVersion} available
                  </span>
                </div>

                {status.releaseNotes && (
                  <p className="text-xs text-muted-foreground line-clamp-3">
                    {status.releaseNotes}
                  </p>
                )}

                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setShowUpdateDialog(true)}
                  disabled={applying}
                  className="w-full"
                >
                  {applying ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Applying update...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Update & Restart
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Up to date */}
            {status.state === "up_to_date" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                You&apos;re up to date
              </div>
            )}
          </>
        )}

        {/* Help text */}
        <p className="text-xs text-muted-foreground">
          Updates are checked automatically. You can also check manually using
          the refresh button above.
        </p>
      </div>

      {/* Update confirmation dialog */}
      <AlertDialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update & Restart?</AlertDialogTitle>
            <AlertDialogDescription>
              This will download v{status?.latestVersion}, install it, and
              restart the service. Active terminal sessions will persist through
              the restart via tmux.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApply}
              disabled={applying}
            >
              {applying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update & Restart"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
