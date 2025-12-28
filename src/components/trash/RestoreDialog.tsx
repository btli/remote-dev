"use client";

import { useState } from "react";
import { RotateCcw, Folder, AlertCircle, GitBranch } from "lucide-react";
import type { WorktreeTrashItem } from "@/types/trash";
import { useFolderContext } from "@/contexts/FolderContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface RestoreDialogProps {
  open: boolean;
  onClose: () => void;
  item: WorktreeTrashItem | null;
  isPathAvailable: boolean;
  originalFolderId: string | null;
  onRestore: (restorePath?: string, targetFolderId?: string | null) => Promise<void>;
  isProcessing: boolean;
}

export function RestoreDialog({
  open,
  onClose,
  item,
  isPathAvailable,
  originalFolderId,
  onRestore,
  isProcessing,
}: RestoreDialogProps) {
  const { folders } = useFolderContext();
  // Track user's override selection - undefined means use original
  const [folderOverride, setFolderOverride] = useState<string | null | undefined>(undefined);

  // Reset override when dialog closes
  const handleClose = () => {
    setFolderOverride(undefined);
    onClose();
  };

  if (!item || item.resourceType !== "worktree") {
    return null;
  }

  const metadata = item.metadata;
  const needsFolderSelection = !originalFolderId && metadata?.originalFolderId;

  // Use override if set, otherwise use original
  const effectiveFolderId = folderOverride !== undefined ? folderOverride : originalFolderId;

  const handleRestore = async () => {
    await onRestore(undefined, effectiveFolderId);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-green-400" />
            Restore from Trash
          </DialogTitle>
          <DialogDescription>
            Restore this worktree to your session list.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Item info */}
          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="w-4 h-4 text-primary" />
              <span className="text-foreground font-medium">{item.resourceName}</span>
            </div>
            {metadata && (
              <>
                <div className="text-xs text-muted-foreground">
                  Repository: {metadata.repoName}
                </div>
                <div className="text-xs text-muted-foreground">
                  Branch: {metadata.worktreeBranch}
                </div>
              </>
            )}
          </div>

          {/* Path availability warning */}
          {!isPathAvailable && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-200">
                The original worktree path is no longer available. A new path will be
                generated.
              </div>
            </div>
          )}

          {/* Folder selection */}
          {needsFolderSelection && folders.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  Original folder no longer exists
                </div>
              </Label>
              <Select
                value={effectiveFolderId || "__root__"}
                onValueChange={(val) =>
                  setFolderOverride(val === "__root__" ? null : val)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">(No folder)</span>
                    </div>
                  </SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      <div className="flex items-center gap-2">
                        <Folder className="w-3.5 h-3.5 text-primary" />
                        {folder.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The original folder &quot;{metadata?.originalFolderName}&quot; was deleted.
                Choose where to restore this session.
              </p>
            </div>
          )}

          {/* Original folder info */}
          {originalFolderId && metadata?.originalFolderName && (
            <div className="text-xs text-muted-foreground">
              Will restore to folder: {metadata.originalFolderName}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button onClick={handleRestore} disabled={isProcessing}>
            {isProcessing ? "Restoring..." : "Restore"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
