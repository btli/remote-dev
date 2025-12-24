"use client";

import { useState, useEffect } from "react";
import { Trash2, RotateCcw, Calendar, GitBranch } from "lucide-react";
import { useTrashContext } from "@/contexts/TrashContext";
import { getDaysUntilExpiry } from "@/types/trash";
import type { TrashItem, WorktreeTrashItem, TrashItemWithMetadata } from "@/types/trash";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RestoreDialog } from "./RestoreDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

interface TrashModalProps {
  open: boolean;
  onClose: () => void;
}

export function TrashModal({ open, onClose }: TrashModalProps) {
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

  const [selectedItem, setSelectedItem] = useState<TrashItemWithMetadata | null>(null);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isPathAvailable, setIsPathAvailable] = useState(true);
  const [originalFolderId, setOriginalFolderId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Trigger cleanup when modal opens
  useEffect(() => {
    if (open) {
      cleanupExpired();
    }
  }, [open, cleanupExpired]);

  const handleRestoreClick = async (item: TrashItem) => {
    const availability = await checkRestoreAvailability(item.id);
    if (!availability) return;

    setSelectedItem(availability.item);
    setIsPathAvailable(availability.isPathAvailable);
    setOriginalFolderId(availability.originalFolderId);
    setShowRestoreDialog(true);
  };

  const handleDeleteClick = async (item: TrashItem) => {
    const fullItem = await checkRestoreAvailability(item.id);
    setSelectedItem(fullItem?.item || (item as TrashItemWithMetadata));
    setShowDeleteDialog(true);
  };

  const handleRestore = async (restorePath?: string, targetFolderId?: string | null) => {
    if (!selectedItem) return;

    setIsProcessing(true);
    try {
      const success = await restoreItem(selectedItem.id, { restorePath, targetFolderId });
      if (success) {
        setShowRestoreDialog(false);
        setSelectedItem(null);
        await refreshTrash();
      }
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

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-slate-400" />
              Trash
            </DialogTitle>
            <DialogDescription>
              Items are automatically deleted after 30 days.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[400px]">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-slate-500">
                Loading...
              </div>
            ) : isEmpty ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                <Trash2 className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">Trash is empty</p>
              </div>
            ) : (
              <div className="space-y-2">
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

          {!isEmpty && (
            <div className="flex justify-end pt-4 border-t border-white/5">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Restore confirmation dialog */}
      <RestoreDialog
        open={showRestoreDialog}
        onClose={() => {
          setShowRestoreDialog(false);
          setSelectedItem(null);
        }}
        item={selectedItem as WorktreeTrashItem}
        isPathAvailable={isPathAvailable}
        originalFolderId={originalFolderId}
        onRestore={handleRestore}
        isProcessing={isProcessing}
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
    </>
  );
}

interface TrashItemRowProps {
  item: TrashItem;
  onRestore: () => void;
  onDelete: () => void;
}

function TrashItemRow({ item, onRestore, onDelete }: TrashItemRowProps) {
  const daysLeft = getDaysUntilExpiry(item.expiresAt);
  const isExpiringSoon = daysLeft <= 7;

  return (
    <div className="group flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors">
      {/* Icon */}
      <div className="shrink-0">
        <GitBranch className="w-4 h-4 text-violet-400" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{item.resourceName}</p>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Calendar className="w-3 h-3" />
          <span className={isExpiringSoon ? "text-amber-400" : ""}>
            {daysLeft === 0
              ? "Expires today"
              : daysLeft === 1
              ? "1 day left"
              : `${daysLeft} days left`}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRestore}
          className="h-7 w-7 text-slate-400 hover:text-green-400 hover:bg-green-400/10"
          title="Restore"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          className="h-7 w-7 text-slate-400 hover:text-red-400 hover:bg-red-400/10"
          title="Delete permanently"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
