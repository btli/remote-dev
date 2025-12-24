"use client";

/**
 * RepositoriesTab - Repository browser matching sessions tab style
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  GitPullRequest,
  CircleDot,
  FolderGit,
  Clock,
  Lock,
  Globe,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useGitHubStats, useGitHubChanges } from "@/contexts/GitHubStatsContext";
import type { EnrichedRepository, PullRequest } from "@/types/github-stats";

interface RepositoriesTabProps {
  onCreatePRWorktree?: (repoId: string, prNumber: number) => Promise<void>;
  className?: string;
}

export function RepositoriesTab({
  onCreatePRWorktree,
  className,
}: RepositoriesTabProps) {
  const { state, refreshStats, markChangesSeen } = useGitHubStats();
  const { hasChanges, totalNewPRs, totalNewIssues } = useGitHubChanges();
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [creatingWorktree, setCreatingWorktree] = useState<number | null>(null);

  const toggleRepo = (repoId: string) => {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else {
        next.add(repoId);
      }
      return next;
    });
  };

  const handleRefresh = async () => {
    await refreshStats();
  };

  const handleMarkSeen = async () => {
    await markChangesSeen();
  };

  const handleCreateWorktree = async (repoId: string, prNumber: number) => {
    if (!onCreatePRWorktree) return;
    setCreatingWorktree(prNumber);
    try {
      await onCreatePRWorktree(repoId, prNumber);
    } finally {
      setCreatingWorktree(null);
    }
  };

  const openGitHub = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 30) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  // Group repositories by owner
  const groupedRepos = state.repositories.reduce(
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
      {/* Header bar */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          {hasChanges && (
            <button
              onClick={handleMarkSeen}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors"
              title="Mark all as seen"
            >
              <AlertCircle className="w-3 h-3" />
              {totalNewPRs + totalNewIssues} new
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            onClick={handleRefresh}
            variant="ghost"
            size="icon-sm"
            className="h-5 w-5 text-slate-400 hover:text-white hover:bg-white/10"
            disabled={state.isRefreshing}
            title="Refresh"
          >
            <RefreshCw
              className={cn("w-3 h-3", state.isRefreshing && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      {/* Repository list */}
      <div className="flex-1 overflow-y-auto py-1 px-1.5 space-y-0.5">
        {state.isLoading && state.repositories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin mb-2" />
            <span className="text-[10px]">Loading...</span>
          </div>
        ) : state.repositories.length === 0 ? (
          <div className="text-center py-8 px-2">
            <FolderGit className="w-5 h-5 mx-auto text-slate-600 mb-2" />
            <p className="text-[10px] text-slate-500">No repositories</p>
          </div>
        ) : (
          Object.entries(groupedRepos).map(([owner, repos]) => (
            <OwnerGroup
              key={owner}
              owner={owner}
              repos={repos}
              expandedRepos={expandedRepos}
              onToggleRepo={toggleRepo}
              onOpenGitHub={openGitHub}
              onCreateWorktree={
                onCreatePRWorktree
                  ? (repoId, prNumber) => handleCreateWorktree(repoId, prNumber)
                  : undefined
              }
              creatingWorktree={creatingWorktree}
              formatRelativeTime={formatRelativeTime}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {state.lastRefresh && (
        <div className="px-2 py-1 border-t border-white/5">
          <span className="flex items-center gap-1 text-[9px] text-slate-600">
            <Clock className="w-2.5 h-2.5" />
            Updated {formatRelativeTime(state.lastRefresh.toISOString())}
          </span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Owner Group
// =============================================================================

interface OwnerGroupProps {
  owner: string;
  repos: EnrichedRepository[];
  expandedRepos: Set<string>;
  onToggleRepo: (repoId: string) => void;
  onOpenGitHub: (url: string) => void;
  onCreateWorktree?: (repoId: string, prNumber: number) => void;
  creatingWorktree: number | null;
  formatRelativeTime: (dateString: string) => string;
}

function OwnerGroup({
  owner,
  repos,
  expandedRepos,
  onToggleRepo,
  onOpenGitHub,
  onCreateWorktree,
  creatingWorktree,
  formatRelativeTime,
}: OwnerGroupProps) {
  return (
    <div className="space-y-0.5">
      {/* Owner header */}
      <div className="flex items-center gap-1.5 px-1 py-0.5">
        <span className="text-[10px] text-slate-500 font-medium truncate">
          {owner}
        </span>
        <span className="text-[9px] text-slate-600">({repos.length})</span>
      </div>

      {/* Repos */}
      {repos.map((repo) => (
        <RepoItem
          key={repo.id}
          repo={repo}
          isExpanded={expandedRepos.has(repo.id)}
          onToggle={() => onToggleRepo(repo.id)}
          onOpenGitHub={onOpenGitHub}
          onCreateWorktree={onCreateWorktree}
          creatingWorktree={creatingWorktree}
          formatRelativeTime={formatRelativeTime}
        />
      ))}
    </div>
  );
}

// =============================================================================
// Repo Item (like a session item)
// =============================================================================

interface RepoItemProps {
  repo: EnrichedRepository;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenGitHub: (url: string) => void;
  onCreateWorktree?: (repoId: string, prNumber: number) => void;
  creatingWorktree: number | null;
  formatRelativeTime: (dateString: string) => string;
}

function RepoItem({
  repo,
  isExpanded,
  onToggle,
  onOpenGitHub,
  onCreateWorktree,
  creatingWorktree,
  formatRelativeTime,
}: RepoItemProps) {
  const hasPRs = repo.pullRequests.length > 0;
  const hasContent = hasPRs;

  return (
    <div className="space-y-0.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            onClick={() => hasContent && onToggle()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (hasContent) onToggle();
              }
            }}
            className={cn(
              "group relative flex items-center gap-1.5 px-2 py-1 rounded-md ml-2",
              "transition-all duration-150",
              "hover:bg-white/5 border border-transparent",
              isExpanded && "bg-white/5"
            )}
          >
            {/* Expand chevron */}
            {hasContent ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                className="text-slate-500 hover:text-white shrink-0"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>
            ) : (
              <span className="w-3" />
            )}

            {/* Privacy icon */}
            {repo.isPrivate ? (
              <Lock className="w-3 h-3 text-amber-400/70 shrink-0" />
            ) : (
              <Globe className="w-3 h-3 text-slate-500 shrink-0" />
            )}

            {/* Repo name */}
            <span className="text-xs text-slate-300 group-hover:text-white truncate flex-1">
              {repo.name}
            </span>

            {/* Stats badges */}
            <div className="flex items-center gap-1 shrink-0">
              {repo.stats.openPRCount > 0 && (
                <span className="flex items-center gap-0.5 text-[9px] text-violet-400">
                  <GitPullRequest className="w-2.5 h-2.5" />
                  {repo.stats.openPRCount}
                </span>
              )}
              {repo.stats.openIssueCount > 0 && (
                <span className="flex items-center gap-0.5 text-[9px] text-emerald-400">
                  <CircleDot className="w-2.5 h-2.5" />
                  {repo.stats.openIssueCount}
                </span>
              )}
              {repo.hasChanges && (
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem onClick={() => onOpenGitHub(repo.url)}>
            <ExternalLink className="w-3 h-3 mr-2" />
            Open on GitHub
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onOpenGitHub(`${repo.url}/pulls`)}>
            <GitPullRequest className="w-3 h-3 mr-2" />
            View PRs
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onOpenGitHub(`${repo.url}/issues`)}>
            <CircleDot className="w-3 h-3 mr-2" />
            View Issues
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Expanded content - PRs */}
      {isExpanded && hasPRs && (
        <div className="ml-6 space-y-0.5">
          {repo.pullRequests.slice(0, 5).map((pr) => (
            <PRItem
              key={pr.id}
              pr={pr}
              repoId={repo.id}
              onOpenGitHub={onOpenGitHub}
              onCreateWorktree={onCreateWorktree}
              isCreating={creatingWorktree === pr.number}
              formatRelativeTime={formatRelativeTime}
            />
          ))}
          {repo.pullRequests.length > 5 && (
            <button
              onClick={() => onOpenGitHub(`${repo.url}/pulls`)}
              className="text-[10px] text-violet-400 hover:text-violet-300 px-2 py-0.5"
            >
              +{repo.pullRequests.length - 5} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PR Item (like a nested session)
// =============================================================================

interface PRItemProps {
  pr: PullRequest;
  repoId: string;
  onOpenGitHub: (url: string) => void;
  onCreateWorktree?: (repoId: string, prNumber: number) => void;
  isCreating: boolean;
  formatRelativeTime: (dateString: string) => string;
}

function PRItem({
  pr,
  repoId,
  onOpenGitHub,
  onCreateWorktree,
  isCreating,
  formatRelativeTime,
}: PRItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpenGitHub(pr.url)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenGitHub(pr.url);
            }
          }}
          className={cn(
            "group flex items-center gap-1.5 px-2 py-1 rounded-md",
            "hover:bg-white/5 transition-colors cursor-pointer"
          )}
        >
          {/* PR indicator */}
          <GitPullRequest className="w-3 h-3 text-violet-400 shrink-0" />

          {/* PR info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-violet-400 font-medium shrink-0">
                #{pr.number}
              </span>
              <span className="text-[10px] text-slate-400 truncate">
                {pr.title}
              </span>
            </div>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-1 shrink-0">
            {pr.isNew && (
              <span className="text-[8px] px-1 py-0.5 bg-violet-500/20 text-violet-400 rounded">
                new
              </span>
            )}
            {pr.isDraft && (
              <span className="text-[8px] px-1 py-0.5 bg-slate-500/20 text-slate-400 rounded">
                draft
              </span>
            )}
            <span className="text-[9px] text-slate-600">
              {formatRelativeTime(pr.updatedAt)}
            </span>
          </div>

          {/* Worktree button */}
          {onCreateWorktree && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCreateWorktree(repoId, pr.number);
              }}
              disabled={isCreating}
              className={cn(
                "p-0.5 rounded opacity-0 group-hover:opacity-100",
                "hover:bg-white/10 transition-all duration-150",
                "text-slate-500 hover:text-violet-400"
              )}
              title="Create worktree"
            >
              {isCreating ? (
                <span className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin block" />
              ) : (
                <FolderGit className="w-3 h-3" />
              )}
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={() => onOpenGitHub(pr.url)}>
          <ExternalLink className="w-3 h-3 mr-2" />
          Open on GitHub
        </ContextMenuItem>
        {onCreateWorktree && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onCreateWorktree(repoId, pr.number)}>
              <FolderGit className="w-3 h-3 mr-2" />
              Create Worktree
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
