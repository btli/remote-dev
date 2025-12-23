"use client";

/**
 * RepositoriesTab - Main repository browser tab for the sidebar
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  ExternalLink,
  Settings,
  Github,
  Clock,
  Search,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RepositoryCard } from "./RepositoryCard";
import { ChangeIndicator } from "./StatusBadge";
import { useGitHubStats, useGitHubChanges } from "@/contexts/GitHubStatsContext";
import type { EnrichedRepository } from "@/types/github-stats";

interface RepositoriesTabProps {
  onCreatePRWorktree?: (repoId: string, prNumber: number) => Promise<void>;
  onOpenSettings?: () => void;
  className?: string;
}

export function RepositoriesTab({
  onCreatePRWorktree,
  onOpenSettings,
  className,
}: RepositoriesTabProps) {
  const { state, refreshStats, markChangesSeen } = useGitHubStats();
  const { hasChanges, totalNewPRs, totalNewIssues } = useGitHubChanges();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredRepos = state.repositories.filter((repo) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      repo.name.toLowerCase().includes(query) ||
      repo.fullName.toLowerCase().includes(query)
    );
  });

  const handleRefresh = async () => {
    await refreshStats();
  };

  const handleMarkSeen = async () => {
    await markChangesSeen();
  };

  const formatLastRefresh = () => {
    if (!state.lastRefresh) return "Never";

    const now = new Date();
    const diff = now.getTime() - state.lastRefresh.getTime();
    const mins = Math.floor(diff / 60000);

    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return state.lastRefresh.toLocaleDateString();
  };

  // Group repositories by owner
  const groupedRepos = filteredRepos.reduce(
    (acc, repo) => {
      const owner = repo.owner;
      if (!acc[owner]) acc[owner] = [];
      acc[owner].push(repo);
      return acc;
    },
    {} as Record<string, EnrichedRepository[]>
  );

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Github className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-medium text-white">Repositories</span>
          {hasChanges && (
            <ChangeIndicator
              count={totalNewPRs + totalNewIssues}
              pulse
            />
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {hasChanges && (
            <Button
              onClick={handleMarkSeen}
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
              title="Mark all as seen"
            >
              <AlertCircle className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            onClick={handleRefresh}
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6 text-slate-400 hover:text-white hover:bg-white/10"
            disabled={state.isRefreshing}
            title="Refresh stats"
          >
            <RefreshCw
              className={cn(
                "w-3.5 h-3.5",
                state.isRefreshing && "animate-spin"
              )}
            />
          </Button>
          {onOpenSettings && (
            <Button
              onClick={onOpenSettings}
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 text-slate-400 hover:text-white hover:bg-white/10"
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      {state.repositories.length > 3 && (
        <div className="px-3 py-2 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "w-full bg-slate-800/50 border border-white/10 rounded-md",
                "pl-8 pr-3 py-1.5 text-xs text-white",
                "placeholder:text-slate-500",
                "focus:outline-none focus:border-violet-500/50"
              )}
            />
          </div>
        </div>
      )}

      {/* Repository List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-3">
          {state.isLoading && state.repositories.length === 0 ? (
            <LoadingState />
          ) : state.repositories.length === 0 ? (
            <EmptyState />
          ) : filteredRepos.length === 0 ? (
            <NoResultsState query={searchQuery} />
          ) : (
            Object.entries(groupedRepos).map(([owner, repos]) => (
              <div key={owner} className="space-y-1.5">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs text-slate-500 font-medium">
                    {owner}
                  </span>
                  <span className="text-[10px] text-slate-600">
                    {repos.length} repos
                  </span>
                </div>
                <div className="space-y-1.5">
                  {repos.map((repo) => (
                    <RepositoryCard
                      key={repo.id}
                      repository={repo}
                      onCreatePRWorktree={onCreatePRWorktree}
                      onRefresh={async (id) => {
                        // Single repo refresh
                        await fetch(`/api/github/stats/${id}`, {
                          method: "POST",
                        });
                        await refreshStats();
                      }}
                      showRecentCommits
                      isCompact
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-white/5">
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Updated {formatLastRefresh()}
          </span>
          <button
            onClick={() =>
              window.open("https://github.com", "_blank", "noopener,noreferrer")
            }
            className="flex items-center gap-1 hover:text-slate-400 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            GitHub
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-slate-500">
      <RefreshCw className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs">Loading repositories...</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Github className="w-8 h-8 text-slate-600 mb-3" />
      <p className="text-xs text-slate-500 mb-1">No repositories</p>
      <p className="text-[10px] text-slate-600 max-w-[180px]">
        Clone a repository from GitHub to see it here with stats
      </p>
    </div>
  );
}

function NoResultsState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Search className="w-6 h-6 text-slate-600 mb-2" />
      <p className="text-xs text-slate-500">
        No repositories matching &quot;{query}&quot;
      </p>
    </div>
  );
}
