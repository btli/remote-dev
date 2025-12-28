"use client";

import { useState, useEffect, useCallback } from "react";
import { Trash2, RefreshCw, Loader2 } from "lucide-react";
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
import { TmuxSessionList } from "./TmuxSessionList";
import type { TmuxSessionResponse } from "@/types/tmux";

/**
 * TmuxSessionManager - Main container for tmux session management UI.
 *
 * Displays all tmux sessions with orphan detection and provides
 * actions to terminate individual sessions or clean up all orphans.
 */
export function TmuxSessionManager() {
  const [sessions, setSessions] = useState<TmuxSessionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [terminating, setTerminating] = useState<string | null>(null);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const res = await fetch("/api/tmux/sessions");
      if (!res.ok) {
        throw new Error("Failed to fetch tmux sessions");
      }

      const data = await res.json();
      setSessions(data.sessions);
    } catch (err) {
      console.error("Failed to load tmux sessions:", err);
      setError("Failed to load tmux sessions");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleTerminate = useCallback(
    async (sessionName: string) => {
      setTerminating(sessionName);
      try {
        const res = await fetch(`/api/tmux/sessions?name=${encodeURIComponent(sessionName)}`, {
          method: "DELETE",
        });

        if (!res.ok) {
          throw new Error("Failed to terminate session");
        }

        // Reload the list
        await loadSessions();
      } catch (err) {
        console.error("Failed to terminate session:", err);
        setError("Failed to terminate session");
      } finally {
        setTerminating(null);
      }
    },
    [loadSessions]
  );

  const handleCleanupAll = useCallback(async () => {
    setCleaning(true);
    try {
      const res = await fetch("/api/tmux/sessions/orphaned", {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to clean up orphaned sessions");
      }

      setShowCleanupDialog(false);
      // Reload the list
      await loadSessions();
    } catch (err) {
      console.error("Failed to clean up orphaned sessions:", err);
      setError("Failed to clean up orphaned sessions");
    } finally {
      setCleaning(false);
    }
  }, [loadSessions]);

  const orphanedCount = sessions.filter((s) => s.isOrphaned).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading tmux sessions...</span>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header with refresh and cleanup buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-foreground">Tmux Sessions</Label>
            <span className="text-xs text-muted-foreground">
              ({sessions.length} total{orphanedCount > 0 ? `, ${orphanedCount} orphaned` : ""})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadSessions(true)}
              disabled={refreshing}
              title="Refresh session list"
            >
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
              />
            </Button>

            {orphanedCount > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowCleanupDialog(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clean up {orphanedCount} orphaned
              </Button>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            {error}
          </div>
        )}

        {/* Session list */}
        <TmuxSessionList
          sessions={sessions}
          onTerminate={handleTerminate}
          terminating={terminating}
        />

        {/* Help text */}
        <p className="text-xs text-muted-foreground">
          Orphaned sessions are tmux processes that are no longer tracked in the database.
          They may have been left behind after a crash or improper shutdown.
        </p>
      </div>

      {/* Cleanup confirmation dialog */}
      <AlertDialog open={showCleanupDialog} onOpenChange={setShowCleanupDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clean up orphaned sessions?</AlertDialogTitle>
            <AlertDialogDescription>
              This will terminate {orphanedCount} tmux session
              {orphanedCount !== 1 ? "s" : ""} that{" "}
              {orphanedCount !== 1 ? "are" : "is"} no longer tracked in the
              database. Any running processes in these sessions will be stopped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleaning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCleanupAll}
              disabled={cleaning}
              className="bg-destructive hover:bg-destructive/90"
            >
              {cleaning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cleaning...
                </>
              ) : (
                "Clean Up"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
