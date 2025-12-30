"use client";

/**
 * PRsModal - Modal for viewing and managing GitHub Pull Requests
 *
 * Uses existing PR data from GitHubStatsContext (background polling).
 * Features:
 * - Search PRs by title/branch
 * - Filter by state (Open/Merged/Closed)
 * - Filter by review status
 */

import { useState, useCallback, useMemo } from "react";
import Image from "next/image";
import {
  GitPullRequest,
  GitMerge,
  CircleCheck,
  RefreshCw,
  ExternalLink,
  Search,
  X,
  CircleDot,
  CheckCircle,
  XCircle,
  Clock,
  User,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGitHubStats } from "@/contexts/GitHubStatsContext";
import type { PullRequest } from "@/types/github-stats";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Badge } from "@/components/ui/badge";
import { Copy } from "lucide-react";

type StateFilter = "all" | "open" | "merged" | "closed";

interface PRsModalProps {
  open: boolean;
  onClose: () => void;
  repositoryId: string;
  repositoryName: string;
  repositoryUrl?: string;
  onCheckoutBranch?: (pr: PullRequest) => void;
}

export function PRsModal({
  open,
  onClose,
  repositoryId,
  repositoryName,
  repositoryUrl,
  onCheckoutBranch,
}: PRsModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        {/* Only render content when open - state resets naturally on unmount */}
        {open && (
          <PRsModalContent
            repositoryId={repositoryId}
            repositoryName={repositoryName}
            repositoryUrl={repositoryUrl}
            onCheckoutBranch={onCheckoutBranch}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface PRsModalContentProps {
  repositoryId: string;
  repositoryName: string;
  repositoryUrl?: string;
  onCheckoutBranch?: (pr: PullRequest) => void;
}

function PRsModalContent({
  repositoryId,
  repositoryName,
  repositoryUrl,
  onCheckoutBranch,
}: PRsModalContentProps) {
  const { getRepositoryById, refreshStats, state } = useGitHubStats();
  const { isLoading, lastRefresh } = state;

  const repository = getRepositoryById(repositoryId);
  const pullRequests = useMemo(
    () => repository?.pullRequests ?? [],
    [repository?.pullRequests]
  );

  // Filter state - resets naturally when component unmounts (modal closes)
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");

  // Filter PRs based on search and state
  const filteredPRs = useMemo(() => {
    return pullRequests.filter((pr) => {
      // State filter
      if (stateFilter !== "all") {
        if (stateFilter === "open" && pr.state !== "open") return false;
        if (stateFilter === "merged" && pr.state !== "merged") return false;
        if (stateFilter === "closed" && pr.state !== "closed") return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = pr.title.toLowerCase().includes(query);
        const matchesBranch = pr.branch.toLowerCase().includes(query);
        const matchesNumber = `#${pr.number}`.includes(query);
        const matchesAuthor = pr.author.toLowerCase().includes(query);
        if (!matchesTitle && !matchesBranch && !matchesNumber && !matchesAuthor) {
          return false;
        }
      }

      return true;
    });
  }, [pullRequests, stateFilter, searchQuery]);

  // Count PRs by state
  const openCount = pullRequests.filter((pr) => pr.state === "open").length;
  const mergedCount = pullRequests.filter((pr) => pr.state === "merged").length;
  const closedCount = pullRequests.filter((pr) => pr.state === "closed").length;

  const handleOpenInGitHub = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleCopyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    refreshStats();
  }, [refreshStats]);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setStateFilter("open");
  }, []);

  const hasActiveFilters =
    searchQuery.trim() !== "" || stateFilter !== "open";

  return (
    <>
      <DialogHeader className="shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitPullRequest className="w-5 h-5 text-chart-1" />
            <DialogTitle className="text-lg">
              {repositoryName} Pull Requests
            </DialogTitle>
          </div>
          <div className="flex items-center gap-2">
            {repositoryUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOpenInGitHub(`${repositoryUrl}/pulls`)}
                className="text-xs"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                GitHub
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
          {lastRefresh
            ? `Last updated ${formatRelativeTime(lastRefresh.toISOString())}`
            : "Loading..."}
        </DialogDescription>
      </DialogHeader>

      {/* Filters */}
      <div className="shrink-0 space-y-3">
        {/* Search row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search PRs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-8 text-xs text-muted-foreground"
            >
              <X className="w-3 h-3 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {/* State tabs */}
        <Tabs
          value={stateFilter}
          onValueChange={(v) => setStateFilter(v as StateFilter)}
        >
          <TabsList className="h-8">
            <TabsTrigger value="open" className="text-xs h-6 px-3">
              <GitPullRequest className="w-3 h-3 mr-1 text-chart-1" />
              Open
              <span className="ml-1.5 text-muted-foreground">
                ({openCount})
              </span>
            </TabsTrigger>
            <TabsTrigger value="merged" className="text-xs h-6 px-3">
              <GitMerge className="w-3 h-3 mr-1 text-purple-500" />
              Merged
              <span className="ml-1.5 text-muted-foreground">
                ({mergedCount})
              </span>
            </TabsTrigger>
            <TabsTrigger value="closed" className="text-xs h-6 px-3">
              <CircleCheck className="w-3 h-3 mr-1 text-destructive" />
              Closed
              <span className="ml-1.5 text-muted-foreground">
                ({closedCount})
              </span>
            </TabsTrigger>
            <TabsTrigger value="all" className="text-xs h-6 px-3">
              All
              <span className="ml-1.5 text-muted-foreground">
                ({pullRequests.length})
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {isLoading && pullRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Loading PRs...</p>
          </div>
        ) : filteredPRs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <GitPullRequest className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              {hasActiveFilters
                ? "No PRs match your filters"
                : "No pull requests found"}
            </p>
            {hasActiveFilters && (
              <Button
                variant="link"
                size="sm"
                onClick={clearFilters}
                className="mt-2 text-xs"
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <ScrollArea className="h-[calc(85vh-260px)]">
            <div className="space-y-2 pr-4">
              {filteredPRs.map((pr) => (
                <PRCard
                  key={pr.id}
                  pr={pr}
                  onOpenInGitHub={handleOpenInGitHub}
                  onCopyUrl={handleCopyUrl}
                  onCheckoutBranch={onCheckoutBranch}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </>
  );
}

interface PRCardProps {
  pr: PullRequest;
  onOpenInGitHub: (url: string) => void;
  onCopyUrl: (url: string) => void;
  onCheckoutBranch?: (pr: PullRequest) => void;
}

function PRCard({ pr, onOpenInGitHub, onCopyUrl, onCheckoutBranch }: PRCardProps) {
  const stateIcon = useMemo(() => {
    switch (pr.state) {
      case "open":
        return <GitPullRequest className="w-4 h-4 text-chart-1" />;
      case "merged":
        return <GitMerge className="w-4 h-4 text-purple-500" />;
      case "closed":
        return <CircleCheck className="w-4 h-4 text-destructive" />;
      default:
        return <GitPullRequest className="w-4 h-4" />;
    }
  }, [pr.state]);

  const reviewIcon = useMemo(() => {
    switch (pr.reviewDecision) {
      case "APPROVED":
        return <CheckCircle className="w-3 h-3 text-chart-2" />;
      case "CHANGES_REQUESTED":
        return <XCircle className="w-3 h-3 text-destructive" />;
      case "REVIEW_REQUIRED":
        return <Clock className="w-3 h-3 text-yellow-500" />;
      default:
        return null;
    }
  }, [pr.reviewDecision]);

  const ciIcon = useMemo(() => {
    if (!pr.ciStatus) return null;
    switch (pr.ciStatus.state) {
      case "passing":
        return <CircleDot className="w-3 h-3 text-chart-2" />;
      case "failing":
        return <CircleDot className="w-3 h-3 text-destructive" />;
      case "pending":
        return <CircleDot className="w-3 h-3 text-yellow-500" />;
      default:
        return null;
    }
  }, [pr.ciStatus]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpenInGitHub(pr.url)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenInGitHub(pr.url);
            }
          }}
          className={cn(
            "group relative p-3 rounded-lg border transition-all duration-150 cursor-pointer",
            "hover:bg-accent/50 border-border/50 hover:border-border",
            pr.isNew && "ring-1 ring-primary/30"
          )}
        >
          {/* Header Row */}
          <div className="flex items-start gap-2">
            {/* Status Icon */}
            <div className="mt-0.5 shrink-0">{stateIcon}</div>

            {/* Title & Number */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-primary">
                  #{pr.number}
                </span>
                {pr.isDraft && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    Draft
                  </Badge>
                )}
                {pr.isNew && (
                  <span className="text-[8px] px-1 py-0.5 bg-primary/20 text-primary rounded">
                    new
                  </span>
                )}
              </div>
              <h4 className="text-sm font-medium text-foreground truncate">
                {pr.title}
              </h4>
            </div>

            {/* Status indicators */}
            <div className="flex items-center gap-1.5 shrink-0">
              {reviewIcon}
              {ciIcon}
            </div>
          </div>

          {/* Branch info */}
          <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground ml-6">
            <GitBranch className="w-3 h-3" />
            <span className="truncate max-w-[120px]">{pr.branch}</span>
            <span>→</span>
            <span className="truncate max-w-[80px]">{pr.baseBranch}</span>
          </div>

          {/* Meta Row */}
          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground ml-6">
            {/* Author */}
            <div className="flex items-center gap-1">
              {pr.authorAvatarUrl ? (
                <Image
                  src={pr.authorAvatarUrl}
                  alt={pr.author}
                  width={14}
                  height={14}
                  className="w-3.5 h-3.5 rounded-full"
                />
              ) : (
                <User className="w-3 h-3" />
              )}
              <span>{pr.author}</span>
            </div>

            {/* Changes */}
            <div className="flex items-center gap-1">
              <span className="text-chart-2">+{pr.additions}</span>
              <span className="text-destructive">-{pr.deletions}</span>
            </div>

            {/* Updated Time */}
            <span className="ml-auto">
              {formatRelativeTime(pr.updatedAt)}
            </span>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => onOpenInGitHub(pr.url)}>
          <ExternalLink className="w-3.5 h-3.5 mr-2" />
          Open on GitHub
        </ContextMenuItem>
        {onCheckoutBranch && pr.state === "open" && (
          <ContextMenuItem onClick={() => onCheckoutBranch(pr)}>
            <GitBranch className="w-3.5 h-3.5 mr-2" />
            Checkout Branch
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCopyUrl(pr.url)}>
          <Copy className="w-3.5 h-3.5 mr-2" />
          Copy URL
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
