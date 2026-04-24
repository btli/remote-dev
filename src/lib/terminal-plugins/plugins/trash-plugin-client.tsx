/**
 * TrashPlugin (client half) — React rendering for the Trash tab.
 *
 * Replaces the Dialog-based `TrashModal`: the list of trash items and the
 * "Trash is empty" state now render directly in the workspace pane as a
 * Global-section terminal tab. The confirm dialogs (`RestoreDialog`,
 * `DeleteConfirmDialog`) remain as real Dialogs — they are short-lived
 * yes/no affordances and don't warrant their own tab.
 *
 * @see ./trash-plugin-server.ts for lifecycle.
 */

import { useState, useEffect, useCallback } from "react";
import { Trash2, RotateCcw, Calendar, GitBranch } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import { cn } from "@/lib/utils";
import { useTrashContext } from "@/contexts/TrashContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { getDaysUntilExpiry } from "@/types/trash";
import type {
  WorktreeTrashItem,
  TrashItemWithMetadata,
} from "@/types/trash";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RestoreDialog } from "@/components/trash/RestoreDialog";
import { DeleteConfirmDialog } from "@/components/trash/DeleteConfirmDialog";

function TrashTabContent({ session }: TerminalTypeClientComponentProps) {
  const {
    trashItems,
    loading,
    isEmpty,
    refreshTrash,
    checkRestoreAvailability,
    restoreItem,
    deleteItem,
    cleanupExpired,
  } = useTrashContext();

  const { refreshSessions, closeSession } = useSessionContext();

  const [selectedItem, setSelectedItem] =
    useState<TrashItemWithMetadata | null>(null);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isPathAvailable, setIsPathAvailable] = useState(true);
  const [originalFolderId, setOriginalFolderId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Trigger cleanup when the tab mounts. Matches the modal's "cleanup on
  // open" behavior; remount happens on every session.id change (new tab)
  // so we don't need a separate `open` flag.
  useEffect(() => {
    cleanupExpired();
  }, [cleanupExpired]);

  const handleRestoreClick = async (item: TrashItemWithMetadata) => {
    const availability = await checkRestoreAvailability(item.id);
    if (!availability) return;

    setSelectedItem(availability.item);
    setIsPathAvailable(availability.isPathAvailable);
    setOriginalFolderId(availability.originalFolderId);
    setShowRestoreDialog(true);
  };

  const handleDeleteClick = async (item: TrashItemWithMetadata) => {
    const fullItem = await checkRestoreAvailability(item.id);
    setSelectedItem(fullItem?.item || item);
    setShowDeleteDialog(true);
  };

  const handleRestore = async (
    restorePath?: string,
    targetFolderId?: string | null
  ) => {
    if (!selectedItem) return;

    setIsProcessing(true);
    setRestoreError(null);
    try {
      const success = await restoreItem(selectedItem.id, {
        restorePath,
        targetFolderId,
      });
      if (success) {
        setShowRestoreDialog(false);
        setSelectedItem(null);
        // Refresh both trash and sessions to update UI
        await Promise.all([refreshTrash(), refreshSessions()]);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to restore";
      setRestoreError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedItem) return;

    setIsProcessing(true);
    try {
      const success = await deleteItem(selectedItem.id);
      if (success) {
        setShowDeleteDialog(false);
        setSelectedItem(null);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Close the Trash tab. Mirrors the modal's "Close" button: since the tab
  // is a singleton (scope-key dedup), closing it is cheap — the next open
  // reopens it via the carrier project.
  const handleClose = useCallback(() => {
    void closeSession(session.id);
  }, [closeSession, session.id]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-popover/30 shrink-0">
        <Trash2 className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Trash</span>
        <span className="text-xs text-muted-foreground">
          Items are automatically deleted after 30 days.
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Loading...
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Trash2 className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">Trash is empty</p>
            </div>
          ) : (
            <div className="space-y-2 p-4">
              {trashItems.map((item) => (
                <TrashItemRow
                  key={item.id}
                  item={item}
                  onRestore={() => handleRestoreClick(item)}
                  onDelete={() => handleDeleteClick(item)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {!isEmpty && (
        <div className="flex justify-end px-4 py-3 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      )}

      {/* Restore confirmation dialog */}
      <RestoreDialog
        open={showRestoreDialog}
        onClose={() => {
          setShowRestoreDialog(false);
          setSelectedItem(null);
          setRestoreError(null);
        }}
        item={selectedItem as WorktreeTrashItem}
        isPathAvailable={isPathAvailable}
        originalFolderId={originalFolderId}
        onRestore={handleRestore}
        isProcessing={isProcessing}
        error={restoreError}
      />

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setSelectedItem(null);
        }}
        item={selectedItem}
        onDelete={handleDelete}
        isProcessing={isProcessing}
      />
    </div>
  );
}

interface TrashItemRowProps {
  item: TrashItemWithMetadata;
  onRestore: () => void;
  onDelete: () => void;
}

function formatDaysLeft(daysLeft: number): string {
  if (daysLeft === 0) return "Expires today";
  if (daysLeft === 1) return "1 day left";
  return `${daysLeft}d left`;
}

function TrashItemRow({ item, onRestore, onDelete }: TrashItemRowProps) {
  const daysLeft = getDaysUntilExpiry(item.expiresAt);
  const isExpiringSoon = daysLeft <= 7;

  // Build the folder/repo path for worktree items
  const getItemPath = (): string | null => {
    if (item.resourceType === "worktree") {
      const worktreeItem = item as WorktreeTrashItem;
      const parts: string[] = [];

      if (worktreeItem.metadata?.originalProjectName) {
        parts.push(worktreeItem.metadata.originalProjectName);
      }

      if (
        worktreeItem.metadata?.repoName &&
        worktreeItem.metadata.repoName !==
          worktreeItem.metadata?.originalProjectName
      ) {
        parts.push(worktreeItem.metadata.repoName);
      }

      return parts.length > 0 ? parts.join(" › ") : null;
    }
    return null;
  };

  const getBranchName = (): string | null => {
    if (item.resourceType === "worktree") {
      const worktreeItem = item as WorktreeTrashItem;
      return worktreeItem.metadata?.worktreeBranch || null;
    }
    return null;
  };

  const itemPath = getItemPath();
  const branchName = getBranchName();

  return (
    <div className="group flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-accent transition-colors">
      <div className="shrink-0">
        <GitBranch className="w-4 h-4 text-primary" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {item.resourceName}
        </p>

        {itemPath && (
          <p className="text-xs text-muted-foreground truncate">{itemPath}</p>
        )}

        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          {branchName && (
            <span className="flex items-center gap-1">
              <GitBranch className="w-3 h-3" />
              <span className="font-mono text-[10px] bg-muted/50 px-1 py-0.5 rounded truncate max-w-[120px]">
                {branchName}
              </span>
            </span>
          )}
          <span
            className={cn(
              "flex items-center gap-1",
              isExpiringSoon && "text-amber-400"
            )}
          >
            <Calendar className="w-3 h-3" />
            {formatDaysLeft(daysLeft)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRestore}
          className="h-7 w-7 text-muted-foreground hover:text-green-400 hover:bg-green-400/10"
          title="Restore"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
          title="Delete permanently"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Default trash client plugin instance */
export const TrashClientPlugin: TerminalTypeClientPlugin = {
  type: "trash",
  displayName: "Trash",
  description: "Restore or permanently delete trashed items",
  icon: Trash2,
  priority: 50,
  builtIn: true,
  component: TrashTabContent,
  deriveTitle: () => "Trash",
};
