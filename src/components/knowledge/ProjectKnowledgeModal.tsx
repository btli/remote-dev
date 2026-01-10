"use client";

/**
 * ProjectKnowledgeModal - Modal wrapper for ProjectKnowledgePanel.
 *
 * Provides a dialog interface for viewing and managing project knowledge
 * from the sidebar folder context menu.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ProjectKnowledgePanel } from "@/components/orchestrator/ProjectKnowledgePanel";

interface ProjectKnowledgeModalProps {
  folderId: string;
  folderName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectKnowledgeModal({
  folderId,
  folderName,
  open,
  onOpenChange,
}: ProjectKnowledgeModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] bg-popover/95 backdrop-blur-xl border-border flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-foreground">
            Project Knowledge
          </DialogTitle>
          <DialogDescription>
            {folderName
              ? `Learned patterns, conventions, and skills for ${folderName}`
              : "View and manage project knowledge"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto">
          <ProjectKnowledgePanel folderId={folderId} className="h-full" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
