"use client";

import { useState } from "react";
import { AlertTriangle, GitBranch, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeleteWorktreeDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  sessionName: string;
  branchName: string;
}

/**
 * Confirmation dialog for deleting a worktree session.
 * Warns users that the worktree and branch will be deleted from disk.
 */
export function DeleteWorktreeDialog({
  open,
  onClose,
  onConfirm,
  sessionName,
  branchName,
}: DeleteWorktreeDialogProps) {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      console.error("Failed to delete worktree session:", error);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <AlertTriangle className="w-5 h-5 text-warning" />
            Delete Worktree Session
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            You are about to close the session <strong className="text-foreground">{sessionName}</strong>.
          </p>

          <div className="bg-card/50 rounded-lg p-3 space-y-2 border border-border">
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="w-4 h-4 text-primary" />
              <span className="text-muted-foreground">Branch:</span>
              <span className="text-foreground font-mono text-xs bg-muted px-2 py-0.5 rounded">
                {branchName}
              </span>
            </div>
          </div>

          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-sm text-destructive">
              <strong>Warning:</strong> This will permanently delete the worktree directory and its contents from disk. Any uncommitted changes will be lost.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={deleting}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            {deleting ? (
              "Deleting..."
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Worktree
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
