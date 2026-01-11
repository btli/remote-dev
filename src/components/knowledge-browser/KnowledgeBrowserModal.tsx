"use client";

/**
 * KnowledgeBrowserModal - Modal wrapper for KnowledgeBrowser.
 *
 * Provides a dialog interface for browsing notes and insights
 * from the sidebar or command palette.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { KnowledgeBrowser } from "./KnowledgeBrowser";

interface KnowledgeBrowserModalProps {
  sessionId?: string | null;
  folderId?: string | null;
  folderName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "notes" | "insights";
}

export function KnowledgeBrowserModal({
  sessionId,
  folderId,
  folderName,
  open,
  onOpenChange,
  defaultTab = "notes",
}: KnowledgeBrowserModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] bg-popover/95 backdrop-blur-xl border-border flex flex-col p-0">
        <DialogHeader className="flex-shrink-0 px-6 pt-6">
          <DialogTitle className="flex items-center gap-2 text-foreground">
            Knowledge Browser
          </DialogTitle>
          <DialogDescription>
            {folderName
              ? `Browse notes and insights for ${folderName}`
              : "Browse all notes and insights"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-hidden">
          <KnowledgeBrowser
            sessionId={sessionId}
            folderId={folderId}
            defaultTab={defaultTab}
            className="h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
