"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RotateCcw, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import type { TerminalSession } from "@/types/session";

interface SessionEndedOverlayProps {
  session: TerminalSession;
  exitCode: number;
  onRestart: () => Promise<void>;
  onDelete: (deleteWorktree?: boolean) => Promise<void>;
}

interface WorktreeCheckResult {
  hasUncommittedChanges: boolean;
  branch: string | null;
}

export function SessionEndedOverlay({
  session,
  exitCode,
  onRestart,
  onDelete,
}: SessionEndedOverlayProps) {
  const [isRestarting, setIsRestarting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showWorktreeConfirm, setShowWorktreeConfirm] = useState(false);
  const [worktreeCheck, setWorktreeCheck] = useState<WorktreeCheckResult | null>(null);
  const [checkingWorktree, setCheckingWorktree] = useState(false);

  const isWorktreeSession = Boolean(session.worktreeBranch && session.githubRepoId);

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      await onRestart();
    } finally {
      setIsRestarting(false);
    }
  };

  const handleDeleteClick = async () => {
    if (isWorktreeSession) {
      // Check for uncommitted changes before showing confirmation
      setCheckingWorktree(true);
      try {
        const response = await fetch("/api/github/worktrees/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            worktreePath: session.projectPath,
            repositoryId: session.githubRepoId,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          setWorktreeCheck(result);
        } else {
          // If check fails, assume no changes and proceed
          setWorktreeCheck({ hasUncommittedChanges: false, branch: session.worktreeBranch });
        }
      } catch {
        setWorktreeCheck({ hasUncommittedChanges: false, branch: session.worktreeBranch });
      } finally {
        setCheckingWorktree(false);
      }
      setShowWorktreeConfirm(true);
    } else {
      // Non-worktree session: just delete
      setIsDeleting(true);
      try {
        await onDelete(false);
      } finally {
        setIsDeleting(false);
      }
    }
  };

  const handleWorktreeDelete = async (deleteWorktree: boolean) => {
    setShowWorktreeConfirm(false);
    setIsDeleting(true);
    try {
      await onDelete(deleteWorktree);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur-sm z-20">
        <div className="max-w-md w-full mx-4 p-6 rounded-xl bg-popover/90 border border-border shadow-2xl">
          <div className="text-center mb-6">
            <div className="mx-auto w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6 text-yellow-500" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Session Ended
            </h3>
            <p className="text-sm text-muted-foreground">
              {exitCode === 0
                ? "The shell exited normally."
                : `The shell exited with code ${exitCode}.`}
            </p>
            {session.projectPath && (
              <p className="text-xs text-muted-foreground mt-2 truncate">
                {session.projectPath}
              </p>
            )}
          </div>

          <div className="flex gap-3 justify-center">
            <Button
              onClick={handleRestart}
              disabled={isRestarting || isDeleting}
              className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-700 text-primary-foreground"
            >
              {isRestarting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4 mr-2" />
              )}
              Restart
            </Button>
            <Button
              onClick={handleDeleteClick}
              disabled={isRestarting || isDeleting || checkingWorktree}
              variant="outline"
              className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              {isDeleting || checkingWorktree ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Worktree deletion confirmation dialog */}
      <Dialog open={showWorktreeConfirm} onOpenChange={setShowWorktreeConfirm}>
        <DialogContent className="bg-popover/95 backdrop-blur-xl border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Worktree Session</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This session is associated with a git worktree for branch{" "}
              <span className="font-mono text-primary">{session.worktreeBranch}</span>.
            </DialogDescription>
          </DialogHeader>

          {worktreeCheck?.hasUncommittedChanges && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-200">
                <p className="font-medium">Uncommitted changes detected</p>
                <p className="text-yellow-300/80 mt-1">
                  The worktree has uncommitted changes that will be lost if deleted.
                </p>
              </div>
            </div>
          )}

          <div className="text-sm text-muted-foreground">
            <p>What would you like to do?</p>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              onClick={() => handleWorktreeDelete(false)}
              variant="outline"
              className="w-full border-border text-muted-foreground hover:bg-accent"
            >
              Close session only
              <span className="text-xs text-muted-foreground ml-2">(keep worktree)</span>
            </Button>
            <Button
              onClick={() => handleWorktreeDelete(true)}
              variant="destructive"
              className="w-full bg-red-600 hover:bg-red-700"
            >
              Delete session and worktree
            </Button>
            <Button
              onClick={() => setShowWorktreeConfirm(false)}
              variant="ghost"
              className="w-full text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
