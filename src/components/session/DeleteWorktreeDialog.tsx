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
      <DialogContent className="sm:max-w-[425px] bg-slate-900 border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Delete Worktree Session
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-slate-300">
            You are about to close the session <strong className="text-white">{sessionName}</strong>.
          </p>

          <div className="bg-slate-800/50 rounded-lg p-3 space-y-2 border border-white/5">
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="w-4 h-4 text-violet-400" />
              <span className="text-slate-400">Branch:</span>
              <span className="text-white font-mono text-xs bg-slate-700 px-2 py-0.5 rounded">
                {branchName}
              </span>
            </div>
          </div>

          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <p className="text-sm text-red-400">
              <strong>Warning:</strong> This will permanently delete the worktree directory and its contents from disk. Any uncommitted changes will be lost.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={deleting}
            className="text-slate-400 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700 text-white"
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
