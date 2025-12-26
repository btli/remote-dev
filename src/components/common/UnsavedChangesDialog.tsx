"use client";

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
import { AlertTriangle } from "lucide-react";

interface UnsavedChangesDialogProps {
  open: boolean;
  onDiscard: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
}

/**
 * UnsavedChangesDialog - A confirmation dialog for unsaved changes
 *
 * Use this component when a modal or form has unsaved changes and the user
 * attempts to close it. Provides options to discard changes or go back.
 */
export function UnsavedChangesDialog({
  open,
  onDiscard,
  onCancel,
  title = "Unsaved Changes",
  description = "You have unsaved changes. Are you sure you want to discard them?",
}: UnsavedChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="bg-slate-900/95 backdrop-blur-xl border-white/10">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onCancel}
            className="bg-transparent border-white/10 text-slate-300 hover:bg-white/5"
          >
            Go Back
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onDiscard}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            Discard Changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
