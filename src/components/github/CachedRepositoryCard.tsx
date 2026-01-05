"use client";

/**
 * CachedRepositoryCard - Card for displaying cached repository in maintenance modal
 *
 * Shows repo name, clone status, and management actions (delete, clone)
 */

import { useState } from "react";
import {
  FolderGit2,
  Trash2,
  Download,
  FolderOpen,
  Lock,
  Globe,
  GitBranch,
  Loader2,
  MoreVertical,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import type { CachedRepositoryWithStats } from "@/services/github-account-service";

interface CachedRepositoryCardProps {
  repository: CachedRepositoryWithStats;
  onDelete: (repoId: string, removeFiles: boolean) => Promise<void>;
  onClone: (repoId: string) => Promise<void>;
  disabled?: boolean;
}

export function CachedRepositoryCard({
  repository,
  onDelete,
  onClone,
  disabled = false,
}: CachedRepositoryCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteWithFiles, setDeleteWithFiles] = useState(false);

  const isCloned = repository.cloneStatus === "cloned";

  const handleDelete = async (removeFiles: boolean) => {
    setIsDeleting(true);
    try {
      await onDelete(repository.id, removeFiles);
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const handleClone = async () => {
    setIsCloning(true);
    try {
      await onClone(repository.id);
    } finally {
      setIsCloning(false);
    }
  };

  const openDeleteDialog = (withFiles: boolean) => {
    setDeleteWithFiles(withFiles);
    setShowDeleteDialog(true);
  };

  const openInFinder = () => {
    if (repository.localPath) {
      // Use the file:// protocol to open in system file manager
      window.open(`file://${repository.localPath}`, "_blank");
    }
  };

  const openOnGitHub = () => {
    window.open(`https://github.com/${repository.fullName}`, "_blank");
  };

  return (
    <>
      <div
        className={cn(
          "group flex items-center justify-between p-2 rounded-lg border border-border/50",
          "bg-card/30 hover:bg-card/50 transition-colors",
          disabled && "opacity-50 pointer-events-none"
        )}
      >
        {/* Repository info */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FolderGit2 className="w-4 h-4 text-muted-foreground shrink-0" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground truncate">
                {repository.name}
              </span>
              {repository.isPrivate ? (
                <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
              ) : (
                <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{repository.fullName}</span>
              <span className="text-border">•</span>
              <GitBranch className="w-3 h-3" />
              <span>{repository.defaultBranch}</span>
            </div>
          </div>
        </div>

        {/* Status and actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Clone status badge */}
          <Badge
            variant={isCloned ? "default" : "secondary"}
            className={cn(
              "text-[10px] px-1.5 py-0",
              isCloned
                ? "bg-green-500/20 text-green-400 border-green-500/30"
                : "bg-muted text-muted-foreground"
            )}
          >
            {isCloned ? "Cloned" : "Not cloned"}
          </Badge>

          {/* Action menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={isDeleting || isCloning}
              >
                {isDeleting || isCloning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <MoreVertical className="w-3.5 h-3.5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={openOnGitHub}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Open on GitHub
              </DropdownMenuItem>

              {isCloned && (
                <DropdownMenuItem onClick={openInFinder}>
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Open in Finder
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {!isCloned ? (
                <DropdownMenuItem onClick={handleClone} disabled={isCloning}>
                  <Download className="w-4 h-4 mr-2" />
                  Clone Repository
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={handleClone}
                  disabled={isCloning}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Re-clone Repository
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => openDeleteDialog(false)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove from Cache
              </DropdownMenuItem>

              {isCloned && (
                <DropdownMenuItem
                  onClick={() => openDeleteDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete with Files
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteWithFiles ? "Delete Repository and Files?" : "Remove from Cache?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteWithFiles ? (
                <>
                  This will permanently delete the local clone of{" "}
                  <strong>{repository.fullName}</strong> and remove it from your
                  cache. This action cannot be undone.
                </>
              ) : (
                <>
                  This will remove <strong>{repository.fullName}</strong> from
                  your cache. The local files (if any) will be preserved.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleDelete(deleteWithFiles)}
              disabled={isDeleting}
              className={cn(
                deleteWithFiles && "bg-destructive hover:bg-destructive/90"
              )}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : deleteWithFiles ? (
                "Delete"
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
