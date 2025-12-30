"use client";

/**
 * IssuesModal - Modal for viewing and managing GitHub issues
 *
 * Features:
 * - Search issues by title/body
 * - Filter by state (All/Open/Closed)
 * - Filter by labels
 * - Create new issues
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  CircleDot,
  CircleCheck,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Search,
  Plus,
  X,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useRepositoryIssues,
  type GitHubIssueDTO,
} from "@/contexts/GitHubIssuesContext";
import { IssueCard } from "./IssueCard";
import { CreateIssueForm } from "./CreateIssueForm";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

type StateFilter = "all" | "open" | "closed";

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
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        {/* Only render content when open - state resets naturally on unmount */}
        {open && (
          <IssuesModalContent
            repositoryId={repositoryId}
            repositoryName={repositoryName}
            repositoryUrl={repositoryUrl}
            onCreateWorktree={onCreateWorktree}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface IssuesModalContentProps {
  repositoryId: string;
  repositoryName: string;
  repositoryUrl?: string;
  onCreateWorktree?: (issue: GitHubIssueDTO, repositoryId: string) => void;
}

function IssuesModalContent({
  repositoryId,
  repositoryName,
  repositoryUrl,
  onCreateWorktree,
}: IssuesModalContentProps) {
  const {
    issues,
    isLoading,
    error,
    cachedAt,
    hasNewIssues,
    newIssueCount,
    refresh,
    markSeen,
  } = useRepositoryIssues(repositoryId);

  // Filter state - resets naturally when component unmounts (modal closes)
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Fetch issues on mount
  useEffect(() => {
    refresh(false);
  }, [refresh]);

  // Mark issues as seen on unmount
  useEffect(() => {
    return () => {
      if (hasNewIssues) {
        markSeen();
      }
    };
  }, [hasNewIssues, markSeen]);

  // Extract unique labels from all issues
  const allLabels = useMemo(() => {
    const labelMap = new Map<string, { name: string; color: string }>();
    for (const issue of issues) {
      for (const label of issue.labels) {
        if (!labelMap.has(label.name)) {
          labelMap.set(label.name, label);
        }
      }
    }
    return Array.from(labelMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [issues]);

  // Filter issues based on search, state, and labels
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      // State filter
      if (stateFilter !== "all" && issue.state !== stateFilter) {
        return false;
      }

      // Label filter
      if (selectedLabels.length > 0) {
        const issueLabels = issue.labels.map((l) => l.name);
        if (!selectedLabels.some((label) => issueLabels.includes(label))) {
          return false;
        }
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = issue.title.toLowerCase().includes(query);
        const matchesBody = issue.bodyPreview?.toLowerCase().includes(query);
        const matchesNumber = `#${issue.number}`.includes(query);
        if (!matchesTitle && !matchesBody && !matchesNumber) {
          return false;
        }
      }

      return true;
    });
  }, [issues, stateFilter, selectedLabels, searchQuery]);

  // Group filtered issues by state for display
  const openIssues = filteredIssues.filter((i) => i.state === "open");
  const closedIssues = filteredIssues.filter((i) => i.state === "closed");

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

  const toggleLabel = useCallback((labelName: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelName)
        ? prev.filter((l) => l !== labelName)
        : [...prev, labelName]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedLabels([]);
    setStateFilter("open");
  }, []);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    selectedLabels.length > 0 ||
    stateFilter !== "open";

  // Count issues by state for tab badges
  const openCount = issues.filter((i) => i.state === "open").length;
  const closedCount = issues.filter((i) => i.state === "closed").length;

  return (
    <>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCreateForm(true)}
              className="text-xs"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              New Issue
            </Button>
            {repositoryUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOpenInGitHub(`${repositoryUrl}/issues`)}
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
          {cachedAt
            ? `Last updated ${formatRelativeTime(cachedAt.toISOString())}`
            : "Loading issues..."}
        </DialogDescription>
      </DialogHeader>

      {/* Create Issue Form */}
      {showCreateForm && repositoryUrl && (
        <CreateIssueForm
          repositoryUrl={repositoryUrl}
          onClose={() => setShowCreateForm(false)}
          onCreated={() => {
            setShowCreateForm(false);
            handleRefresh();
          }}
        />
      )}

      {/* Filters */}
      {!showCreateForm && (
        <div className="shrink-0 space-y-3">
          {/* Search and label filter row */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search issues..."
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

            {/* Label filter dropdown */}
            {allLabels.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-8 text-xs",
                      selectedLabels.length > 0 && "border-primary"
                    )}
                  >
                    <Tag className="w-3.5 h-3.5 mr-1" />
                    Labels
                    {selectedLabels.length > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-1.5 h-4 px-1 text-[10px]"
                      >
                        {selectedLabels.length}
                      </Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {allLabels.map((label) => (
                    <DropdownMenuCheckboxItem
                      key={label.name}
                      checked={selectedLabels.includes(label.name)}
                      onCheckedChange={() => toggleLabel(label.name)}
                    >
                      <span
                        className="w-2 h-2 rounded-full mr-2 shrink-0"
                        style={{ backgroundColor: `#${label.color}` }}
                      />
                      <span className="truncate">{label.name}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

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
                <CircleDot className="w-3 h-3 mr-1 text-chart-2" />
                Open
                <span className="ml-1.5 text-muted-foreground">
                  ({openCount})
                </span>
              </TabsTrigger>
              <TabsTrigger value="closed" className="text-xs h-6 px-3">
                <CircleCheck className="w-3 h-3 mr-1" />
                Closed
                <span className="ml-1.5 text-muted-foreground">
                  ({closedCount})
                </span>
              </TabsTrigger>
              <TabsTrigger value="all" className="text-xs h-6 px-3">
                All
                <span className="ml-1.5 text-muted-foreground">
                  ({issues.length})
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Content */}
      {!showCreateForm && (
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
              <p className="text-sm text-muted-foreground">
                Loading issues...
              </p>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CircleDot className="w-8 h-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "No issues match your filters"
                  : "No issues found"}
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
              <div className="space-y-4 pr-4">
                {/* Show grouped by state when viewing "all" */}
                {stateFilter === "all" ? (
                  <>
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
                                onCreateWorktree
                                  ? handleCreateWorktree
                                  : undefined
                              }
                              onCopyUrl={handleCopyUrl}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {closedIssues.length > 0 && (
                      <div className="mt-6">
                        <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1 opacity-60">
                          <CircleCheck className="w-3 h-3" />
                          Closed ({closedIssues.length})
                        </h3>
                        <div className="space-y-2 opacity-60">
                          {closedIssues.map((issue) => (
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
                  </>
                ) : (
                  /* Show flat list for specific state filter */
                  <div className="space-y-2">
                    {filteredIssues.map((issue) => (
                      <IssueCard
                        key={issue.id}
                        issue={issue}
                        onOpenInGitHub={handleOpenInGitHub}
                        onCreateWorktree={
                          onCreateWorktree && issue.state === "open"
                            ? handleCreateWorktree
                            : undefined
                        }
                        onCopyUrl={handleCopyUrl}
                      />
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </>
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
  if (diffMins < 60)
    return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
  if (diffHours < 24)
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}
