"use client";

/**
 * IssuesModal - Modal for viewing and managing GitHub issues
 */

import { useEffect, useCallback } from "react";
import { CircleDot, RefreshCw, ExternalLink, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useRepositoryIssues,
  type GitHubIssueDTO,
} from "@/contexts/GitHubIssuesContext";
import { IssueCard } from "./IssueCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface IssuesModalProps {
  open: boolean;
  onClose: () => void;
  repositoryId: string;
  repositoryName: string;
  repositoryUrl?: string;
  onCreateWorktree?: (issue: GitHubIssueDTO, repositoryId: string) => void;
}

export function IssuesModal({
  open,
  onClose,
  repositoryId,
  repositoryName,
  repositoryUrl,
  onCreateWorktree,
}: IssuesModalProps) {
  const {
    issues,
    isLoading,
    error,
    cachedAt,
    hasNewIssues,
    newIssueCount,
    refresh,
    markSeen,
  } = useRepositoryIssues(open ? repositoryId : null);

  // Fetch issues when modal opens
  useEffect(() => {
    if (open && repositoryId) {
      refresh(false);
    }
  }, [open, repositoryId, refresh]);

  // Mark issues as seen when modal closes
  useEffect(() => {
    if (!open && hasNewIssues) {
      markSeen();
    }
  }, [open, hasNewIssues, markSeen]);

  const handleOpenInGitHub = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleCopyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch (error) {
      console.error("Failed to copy URL:", error);
    }
  }, []);

  const handleCreateWorktree = useCallback(
    (issue: GitHubIssueDTO) => {
      if (onCreateWorktree) {
        onCreateWorktree(issue, repositoryId);
      }
    },
    [onCreateWorktree, repositoryId]
  );

  const handleRefresh = useCallback(() => {
    refresh(true);
  }, [refresh]);

  const openIssues = issues.filter((i) => i.state === "open");
  const closedIssues = issues.filter((i) => i.state === "closed");

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CircleDot className="w-5 h-5 text-chart-2" />
              <DialogTitle className="text-lg">
                {repositoryName} Issues
              </DialogTitle>
              {hasNewIssues && (
                <span className="text-xs px-1.5 py-0.5 bg-primary/20 text-primary rounded">
                  {newIssueCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {repositoryUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenInGitHub(`${repositoryUrl}/issues`)}
                  className="text-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />
                  View on GitHub
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={isLoading}
                className="h-8 w-8"
              >
                <RefreshCw
                  className={cn("w-4 h-4", isLoading && "animate-spin")}
                />
              </Button>
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {cachedAt
              ? `Last updated ${formatRelativeTime(cachedAt.toISOString())}`
              : "Loading issues..."}
          </DialogDescription>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="w-8 h-8 text-destructive mb-2" />
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                className="mt-4"
              >
                Try Again
              </Button>
            </div>
          ) : isLoading && issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Loading issues...</p>
            </div>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CircleDot className="w-8 h-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No open issues</p>
              {repositoryUrl && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() =>
                    handleOpenInGitHub(`${repositoryUrl}/issues/new`)
                  }
                  className="mt-2 text-xs"
                >
                  Create an issue on GitHub
                </Button>
              )}
            </div>
          ) : (
            <ScrollArea className="h-[calc(85vh-180px)]">
              <div className="space-y-4 pr-4">
                {/* Open Issues */}
                {openIssues.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                      <CircleDot className="w-3 h-3 text-chart-2" />
                      Open ({openIssues.length})
                    </h3>
                    <div className="space-y-2">
                      {openIssues.map((issue) => (
                        <IssueCard
                          key={issue.id}
                          issue={issue}
                          onOpenInGitHub={handleOpenInGitHub}
                          onCreateWorktree={
                            onCreateWorktree ? handleCreateWorktree : undefined
                          }
                          onCopyUrl={handleCopyUrl}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Closed Issues (if any in the cache) */}
                {closedIssues.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1 opacity-60">
                      Closed ({closedIssues.length})
                    </h3>
                    <div className="space-y-2 opacity-60">
                      {closedIssues.slice(0, 5).map((issue) => (
                        <IssueCard
                          key={issue.id}
                          issue={issue}
                          onOpenInGitHub={handleOpenInGitHub}
                          onCopyUrl={handleCopyUrl}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Format a date string to relative time
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}
