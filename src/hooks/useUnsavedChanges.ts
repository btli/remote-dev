"use client";

import { useState, useCallback } from "react";

interface UseUnsavedChangesOptions {
  /** Whether there are unsaved changes */
  hasChanges: boolean;
  /** Callback when the close is confirmed (changes discarded or no changes) */
  onClose: () => void;
}

interface UseUnsavedChangesReturn {
  /** Whether the unsaved changes dialog should be shown */
  showDialog: boolean;
  /** Handler for initiating close (shows dialog if there are changes) */
  handleCloseAttempt: () => void;
  /** Handler for discarding changes and closing */
  handleDiscard: () => void;
  /** Handler for canceling the close attempt */
  handleCancelClose: () => void;
  /** Safe onOpenChange handler for Dialog components */
  handleOpenChange: (open: boolean) => void;
}

/**
 * useUnsavedChanges - A hook for managing unsaved changes confirmation
 *
 * Use this hook to add unsaved changes protection to any modal or form.
 * It handles the logic of showing a confirmation dialog when there are
 * unsaved changes and the user attempts to close.
 *
 * @example
 * ```tsx
 * const { showDialog, handleOpenChange, handleDiscard, handleCancelClose } = useUnsavedChanges({
 *   hasChanges: localSettings !== originalSettings,
 *   onClose: () => setOpen(false),
 * });
 *
 * <Dialog open={open} onOpenChange={handleOpenChange}>
 *   ...
 * </Dialog>
 *
 * <UnsavedChangesDialog
 *   open={showDialog}
 *   onDiscard={handleDiscard}
 *   onCancel={handleCancelClose}
 * />
 * ```
 */
export function useUnsavedChanges({
  hasChanges,
  onClose,
}: UseUnsavedChangesOptions): UseUnsavedChangesReturn {
  const [showDialog, setShowDialog] = useState(false);

  const handleCloseAttempt = useCallback(() => {
    if (hasChanges) {
      setShowDialog(true);
    } else {
      onClose();
    }
  }, [hasChanges, onClose]);

  const handleDiscard = useCallback(() => {
    setShowDialog(false);
    onClose();
  }, [onClose]);

  const handleCancelClose = useCallback(() => {
    setShowDialog(false);
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleCloseAttempt();
      }
    },
    [handleCloseAttempt]
  );

  return {
    showDialog,
    handleCloseAttempt,
    handleDiscard,
    handleCancelClose,
    handleOpenChange,
  };
}
