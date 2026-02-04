"use client";

/**
 * PinnedFilesTab - Manage pinned files for a folder
 *
 * Allows users to pin config files (.env, JSON, etc.) to a folder.
 * Pinned files appear in the sidebar and can be opened as file editor sessions.
 */

import { useState } from "react";
import { Plus, X, FileText, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DirectoryBrowser } from "@/components/common/DirectoryBrowser";
import type { PinnedFile } from "@/types/pinned-files";
import { cn } from "@/lib/utils";

interface PinnedFilesTabProps {
  pinnedFiles: PinnedFile[] | null;
  onUpdate: (files: PinnedFile[] | null) => void;
  /** Initial path for the file browser (e.g., folder's working directory) */
  initialBrowsePath?: string;
}

export function PinnedFilesTab({
  pinnedFiles,
  onUpdate,
  initialBrowsePath,
}: PinnedFilesTabProps) {
  const [showBrowser, setShowBrowser] = useState(false);
  const files = pinnedFiles ?? [];

  function handleAddFile(path: string) {
    const name = path.split("/").pop() ?? path;
    const newFile: PinnedFile = {
      id: crypto.randomUUID(),
      path,
      name,
      sortOrder: files.length,
      createdAt: new Date().toISOString(),
    };

    // Prevent duplicates
    if (files.some((f) => f.path === path)) {
      setShowBrowser(false);
      return;
    }

    onUpdate([...files, newFile]);
    setShowBrowser(false);
  }

  function handleRemoveFile(id: string) {
    const updated = files
      .filter((f) => f.id !== id)
      .map((f, i) => ({ ...f, sortOrder: i }));
    onUpdate(updated.length > 0 ? updated : null);
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const updated = [...files];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    onUpdate(updated.map((f, i) => ({ ...f, sortOrder: i })));
  }

  function handleMoveDown(index: number) {
    if (index >= files.length - 1) return;
    const updated = [...files];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    onUpdate(updated.map((f, i) => ({ ...f, sortOrder: i })));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Pinned Files</p>
          <p className="text-xs text-muted-foreground">
            Pin config files for quick access in the sidebar
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowBrowser(true)}
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add File
        </Button>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground border border-dashed border-border rounded-lg">
          <FileText className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm">No pinned files</p>
          <p className="text-xs mt-1">Click &quot;Add File&quot; to pin a config file</p>
        </div>
      ) : (
        <div className="space-y-1">
          {files.map((file, index) => (
            <div
              key={file.id}
              className={cn(
                "group flex items-center gap-2 px-3 py-2 rounded-md",
                "border border-border bg-muted/30",
                "hover:bg-muted/50 transition-colors"
              )}
            >
              <button
                className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab flex flex-col gap-0.5"
                title="Reorder"
                onClick={() => {
                  // Simple click-based reorder: alternate up/down
                  if (index > 0) handleMoveUp(index);
                  else handleMoveDown(index);
                }}
              >
                <GripVertical className="w-3.5 h-3.5" />
              </button>

              <FileText className="w-4 h-4 shrink-0 text-blue-400" />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {file.name}
                </p>
                <p className="text-[10px] text-muted-foreground truncate" title={file.path}>
                  {file.path}
                </p>
              </div>

              <button
                onClick={() => handleRemoveFile(file.id)}
                className={cn(
                  "p-1 rounded opacity-0 group-hover:opacity-100",
                  "hover:bg-destructive/20 transition-all",
                  "text-muted-foreground hover:text-destructive"
                )}
                title="Remove pinned file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* File browser for adding new files */}
      <DirectoryBrowser
        open={showBrowser}
        onClose={() => setShowBrowser(false)}
        onSelect={handleAddFile}
        initialPath={initialBrowsePath}
        title="Pin a File"
        description="Select a file to pin to this folder"
        mode="file"
        showHidden={true}
      />
    </div>
  );
}
