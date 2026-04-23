"use client";

/**
 * IssuesPlugin (client half) — React rendering for GitHub issues browser
 * sessions. Hosts the existing issue list + detail UI (`IssueCard`,
 * `IssueDetailPanel`, `CreateIssueForm`) inside a full-pane layout instead
 * of a modal.
 *
 * Selection is persisted on the session via `typeMetadataPatch` so the
 * detail view survives reload and tab-switch.
 *
 * @see ./issues-plugin-server.ts for lifecycle.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  useRepositoryIssues,
  type GitHubIssueDTO,
} from "@/contexts/GitHubIssuesContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { IssueCard } from "@/components/github/IssueCard";
import { IssueDetailPanel } from "@/components/github/IssueDetailPanel";
import { CreateIssueForm } from "@/components/github/CreateIssueForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import type { TerminalSession } from "@/types/session";
import type { IssuesSessionMetadata } from "./issues-plugin-server";

type StateFilter = "all" | "open" | "closed";

/**
 * Typed reader for issues session metadata.
 *
 * Returns null when the stored metadata is missing or malformed so the
 * component can render a graceful fallback instead of crashing on a bad
 * row. Mirrors the `readPRsMetadata` pattern used by the PRs plugin.
 */
export function readIssuesMetadata(
  session: TerminalSession
): IssuesSessionMetadata | null {
  const md = session.typeMetadata as Partial<IssuesSessionMetadata> | null;
  if (!md || typeof md.repositoryId !== "string" || !md.repositoryId) {
    return null;
  }
  return {
    repositoryId: md.repositoryId,
    repositoryName:
      typeof md.repositoryName === "string" ? md.repositoryName : "",
    repositoryUrl:
      typeof md.repositoryUrl === "string" ? md.repositoryUrl : "",
    selectedIssueNumber:
      typeof md.selectedIssueNumber === "number"
        ? md.selectedIssueNumber
        : null,
  };
}

function IssuesTabContent({
  session,
  onCreateWorktreeFromIssue,
}: TerminalTypeClientComponentProps) {
  const { updateSession } = useSessionContext();
  const metadata = readIssuesMetadata(session);
  const repositoryId = metadata?.repositoryId ?? "";
  const repositoryName = metadata?.repositoryName ?? "";
  const repositoryUrl = metadata?.repositoryUrl ?? "";
  const selectedIssueNumber = metadata?.selectedIssueNumber ?? null;

  const {
    issues,
    isLoading,
    error,
    cachedAt,
    hasNewIssues,
    newIssueCount,
    refresh,
    markSeen,
  } = useRepositoryIssues(repositoryId || null);

  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const selectedIssue = useMemo(
    () =>
      selectedIssueNumber !== null
        ? issues.find((i) => i.number === selectedIssueNumber) ?? null
        : null,
    [selectedIssueNumber, issues]
  );

  // Fetch on mount / repo change
  useEffect(() => {
    refresh(false);
  }, [refresh]);

  // Mark seen on unmount
  useEffect(() => {
    return () => {
      if (hasNewIssues) {
        markSeen();
      }
    };
  }, [hasNewIssues, markSeen]);

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

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (stateFilter !== "all" && issue.state !== stateFilter) {
        return false;
      }
      if (selectedLabels.length > 0) {
        const issueLabels = issue.labels.map((l) => l.name);
        if (!selectedLabels.some((label) => issueLabels.includes(label))) {
          return false;
        }
      }
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

  const openIssues = filteredIssues.filter((i) => i.state === "open");
  const closedIssues = filteredIssues.filter((i) => i.state === "closed");

  const setSelectedIssueNumber = useCallback(
    (num: number | null) => {
      // Persist selection on the session so it survives reload/tab-switch.
      // Using a shallow patch leaves other typeMetadata fields intact.
      void updateSession(session.id, {
        typeMetadataPatch: { selectedIssueNumber: num },
      }).catch((err) => {
        console.error("Failed to persist issue selection:", err);
      });
    },
    [session.id, updateSession]
  );

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
      if (onCreateWorktreeFromIssue && repositoryId) {
        return onCreateWorktreeFromIssue(issue, repositoryId);
      }
    },
    [onCreateWorktreeFromIssue, repositoryId]
  );

  const handleSelectIssue = useCallback(
    (issue: GitHubIssueDTO) => {
      setSelectedIssueNumber(issue.number);
    },
    [setSelectedIssueNumber]
  );

  const handleBack = useCallback(() => {
    setSelectedIssueNumber(null);
  }, [setSelectedIssueNumber]);

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

  const openCount = issues.filter((i) => i.state === "open").length;
  const closedCount = issues.filter((i) => i.state === "closed").length;

  if (!repositoryId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <AlertCircle className="w-8 h-8 text-destructive mb-2" />
        <p className="text-sm text-destructive">
          Issues session is missing a repository binding.
        </p>
      </div>
    );
  }

  // Detail view — full pane with back affordance
  if (selectedIssue) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden p-4">
        <IssueDetailPanel
          issue={selectedIssue}
          repositoryId={repositoryId}
          onBack={handleBack}
          onStartWorking={handleCreateWorktree}
          onOpenInGitHub={handleOpenInGitHub}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden p-4 gap-3">
      {/* Header */}
      <div className="shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CircleDot className="w-5 h-5 text-chart-2" />
            <h2 className="text-lg font-semibold">
              {repositoryName} Issues &amp; PRs
            </h2>
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
        <p className="text-xs text-muted-foreground mt-1">
          {cachedAt
            ? `Last updated ${formatRelativeTime(cachedAt.toISOString())}`
            : "Loading issues..."}
        </p>
      </div>

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

      {/* Content — native scroll (the IssuesModal bug-fix pattern; ScrollArea
          hits height issues in full-pane layouts). */}
      {!showCreateForm && (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
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
            <div className="space-y-4 pr-2">
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
                            onSelect={handleSelectIssue}
                            onOpenInGitHub={handleOpenInGitHub}
                            onCreateWorktree={
                              onCreateWorktreeFromIssue
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
                            onSelect={handleSelectIssue}
                            onOpenInGitHub={handleOpenInGitHub}
                            onCopyUrl={handleCopyUrl}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  {filteredIssues.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      onSelect={handleSelectIssue}
                      onOpenInGitHub={handleOpenInGitHub}
                      onCreateWorktree={
                        onCreateWorktreeFromIssue && issue.state === "open"
                          ? handleCreateWorktree
                          : undefined
                      }
                      onCopyUrl={handleCopyUrl}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Default issues client plugin instance */
export const IssuesClientPlugin: TerminalTypeClientPlugin = {
  type: "issues",
  displayName: "Issues",
  description: "GitHub issues browser",
  icon: CircleDot,
  priority: 70,
  builtIn: true,
  component: IssuesTabContent,
  deriveTitle(session) {
    const md = readIssuesMetadata(session);
    return md?.repositoryName ? `Issues — ${md.repositoryName}` : null;
  },
};
