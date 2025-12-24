"use client";

/**
 * RepositoryCard - Displays a repository with stats, PRs, and actions
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  FolderGit,
  Plus,
  Clock,
  User,
  Lock,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  StatsRow,
  CIStatusBadge,
  ChangeIndicator,
} from "./StatusBadge";
import type { EnrichedRepository, PullRequest } from "@/types/github-stats";

interface RepositoryCardProps {
  repository: EnrichedRepository;
  onCreatePRWorktree?: (repoId: string, prNumber: number) => Promise<void>;
  onOpenGitHub?: (url: string) => void;
  onRefresh?: (repoId: string) => Promise<void>;
  showRecentCommits?: boolean;
  isCompact?: boolean;
  className?: string;
}

export function RepositoryCard({
  repository,
  onCreatePRWorktree,
  onOpenGitHub,
  onRefresh,
  showRecentCommits = true,
  isCompact = false,
  className,
}: RepositoryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [creatingWorktree, setCreatingWorktree] = useState<number | null>(null);

  const handleCreateWorktree = async (prNumber: number) => {
    if (!onCreatePRWorktree) return;

    setCreatingWorktree(prNumber);
    try {
      await onCreatePRWorktree(repository.id, prNumber);
    } finally {
      setCreatingWorktree(null);
    }
  };

  const handleOpenGitHub = (url: string) => {
    if (onOpenGitHub) {
      onOpenGitHub(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 bg-slate-800/50",
        "hover:bg-slate-800/80 hover:border-violet-500/30",
        "transition-all duration-200",
        className
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-3 p-3 cursor-pointer",
          isCompact && "p-2"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Expand/Collapse */}
        <button className="text-slate-400 hover:text-white">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        {/* Privacy Icon */}
        {repository.isPrivate ? (
          <Lock className="w-4 h-4 text-amber-400 shrink-0" />
        ) : (
          <Globe className="w-4 h-4 text-slate-400 shrink-0" />
        )}

        {/* Repository Name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">
              {repository.name}
            </span>
            {repository.hasChanges && (
              <ChangeIndicator count={repository.changeCount} />
            )}
          </div>
          <span className="text-xs text-slate-500 truncate block">
            {repository.owner}
          </span>
        </div>

        {/* Stats */}
        <StatsRow
          prCount={repository.stats.openPRCount}
          issueCount={repository.stats.openIssueCount}
          ciStatus={repository.stats.ciStatus?.state}
          isProtected={repository.stats.branchProtection?.isProtected}
          compact={isCompact}
        />

        {/* Actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 text-slate-400 hover:text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => handleOpenGitHub(repository.url)}
            >
              <ExternalLink className="w-3.5 h-3.5 mr-2" />
              Open on GitHub
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleOpenGitHub(`${repository.url}/pulls`)}
            >
              <GitPullRequest className="w-3.5 h-3.5 mr-2" />
              View Pull Requests
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleOpenGitHub(`${repository.url}/issues`)}
            >
              <FolderGit className="w-3.5 h-3.5 mr-2" />
              View Issues
            </DropdownMenuItem>
            {onRefresh && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onRefresh(repository.id)}>
                  Refresh Stats
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-white/5 px-3 py-2 space-y-3">
          {/* Open PRs */}
          {repository.pullRequests.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Open Pull Requests
              </h4>
              <div className="space-y-1">
                {repository.pullRequests.slice(0, 5).map((pr) => (
                  <PRItem
                    key={pr.id}
                    pr={pr}
                    onCreateWorktree={
                      onCreatePRWorktree
                        ? () => handleCreateWorktree(pr.number)
                        : undefined
                    }
                    onOpenGitHub={() => handleOpenGitHub(pr.url)}
                    isCreating={creatingWorktree === pr.number}
                    formatRelativeTime={formatRelativeTime}
                  />
                ))}
                {repository.pullRequests.length > 5 && (
                  <button
                    className="text-xs text-violet-400 hover:text-violet-300"
                    onClick={() => handleOpenGitHub(`${repository.url}/pulls`)}
                  >
                    View all {repository.pullRequests.length} PRs →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Recent Commits */}
          {showRecentCommits && repository.stats.recentCommits.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Recent Commits
              </h4>
              <div className="space-y-1">
                {repository.stats.recentCommits.slice(0, 3).map((commit) => (
                  <div
                    key={commit.sha}
                    className="flex items-start gap-2 text-xs group"
                  >
                    <span className="font-mono text-slate-500 shrink-0">
                      {commit.sha.slice(0, 7)}
                    </span>
                    <span className="text-slate-400 truncate flex-1">
                      {commit.message}
                    </span>
                    <span className="text-slate-600 shrink-0">
                      {formatRelativeTime(commit.committedDate)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last Updated */}
          {repository.stats.lastFetchedAt && (
            <div className="flex items-center gap-1 text-[10px] text-slate-600">
              <Clock className="w-3 h-3" />
              Updated {formatRelativeTime(repository.stats.lastFetchedAt.toString())}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PR Item Sub-component
// =============================================================================

interface PRItemProps {
  pr: PullRequest;
  onCreateWorktree?: () => void;
  onOpenGitHub: () => void;
  isCreating?: boolean;
  formatRelativeTime: (dateString: string) => string;
}

function PRItem({
  pr,
  onCreateWorktree,
  onOpenGitHub,
  isCreating,
  formatRelativeTime,
}: PRItemProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 p-2 rounded-md",
        "bg-slate-900/50 hover:bg-slate-900/80",
        "border border-transparent hover:border-violet-500/20",
        "transition-all duration-150"
      )}
    >
      {/* PR Number + Title */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-violet-400 font-medium shrink-0">
            #{pr.number}
          </span>
          <span className="text-xs text-white truncate">{pr.title}</span>
          {pr.isNew && (
            <span className="text-[10px] px-1 py-0.5 bg-violet-500/20 text-violet-400 rounded">
              new
            </span>
          )}
          {pr.isDraft && (
            <span className="text-[10px] px-1 py-0.5 bg-slate-500/20 text-slate-400 rounded">
              draft
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <User className="w-3 h-3 text-slate-500" />
          <span className="text-[10px] text-slate-500">{pr.author}</span>
          <span className="text-[10px] text-slate-600">
            {formatRelativeTime(pr.updatedAt)}
          </span>
        </div>
      </div>

      {/* CI Status */}
      {pr.ciStatus && (
        <CIStatusBadge status={pr.ciStatus.state} size="sm" />
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onCreateWorktree && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6 text-slate-400 hover:text-violet-400"
            onClick={(e) => {
              e.stopPropagation();
              onCreateWorktree();
            }}
            disabled={isCreating}
            title="Create worktree and open session"
          >
            {isCreating ? (
              <span className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <FolderGit className="w-3.5 h-3.5" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 text-slate-400 hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            onOpenGitHub();
          }}
          title="Open on GitHub"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
