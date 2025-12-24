"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import type { TrashItemWithMetadata } from "@/types/trash";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeleteConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  item: TrashItemWithMetadata | null;
  onDelete: () => Promise<void>;
  isProcessing: boolean;
}

export function DeleteConfirmDialog({
  open,
  onClose,
  item,
  onDelete,
  isProcessing,
}: DeleteConfirmDialogProps) {
  if (!item) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-5 h-5" />
            Delete Permanently
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-2">
            <p className="text-sm text-white">
              Are you sure you want to permanently delete{" "}
              <span className="font-medium">&quot;{item.resourceName}&quot;</span>?
            </p>
            <p className="text-xs text-slate-400">
              The worktree directory and all its contents will be removed from disk.
              This cannot be recovered.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onDelete}
            disabled={isProcessing}
          >
            {isProcessing ? (
              "Deleting..."
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Permanently
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
