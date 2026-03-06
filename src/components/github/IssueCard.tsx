"use client";

/**
 * IssueCard - Displays a single GitHub issue with rich preview
 */

import Image from "next/image";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  CircleDot,
  CircleCheck,
  MessageSquare,
  Milestone,
  User,
  Users,
  Copy,
  ExternalLink,
  GitBranch,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { GitHubIssueDTO } from "@/contexts/GitHubIssuesContext";

interface IssueCardProps {
  issue: GitHubIssueDTO;
  onSelect: (issue: GitHubIssueDTO) => void;
  onOpenInGitHub: (url: string) => void;
  onCreateWorktree?: (issue: GitHubIssueDTO) => void;
  onCopyUrl: (url: string) => void;
}

export function IssueCard({
  issue,
  onSelect,
  onOpenInGitHub,
  onCreateWorktree,
  onCopyUrl,
}: IssueCardProps) {
  const isOpen = issue.state === "open";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(issue)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(issue);
            }
          }}
          className={cn(
            "group relative p-3 rounded-lg border transition-all duration-150 cursor-pointer",
            "hover:bg-accent/50 border-border/50 hover:border-border",
            issue.isNew && "ring-1 ring-primary/30"
          )}
        >
          {/* Header Row */}
          <div className="flex items-start gap-2">
            {/* Status Icon */}
            {isOpen ? (
              <CircleDot className="w-4 h-4 text-chart-2 mt-0.5 shrink-0" />
            ) : (
              <CircleCheck className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            )}

            {/* Title & Number */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-primary">
                  #{issue.number}
                </span>
                {issue.isNew && (
                  <span className="text-[8px] px-1 py-0.5 bg-primary/20 text-primary rounded">
                    new
                  </span>
                )}
              </div>
              <h4 className="text-sm font-medium text-foreground truncate">
                {issue.title}
              </h4>
            </div>

            {/* Comments Count */}
            {issue.comments > 0 && (
              <div className="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
                <MessageSquare className="w-3 h-3" />
                <span>{issue.comments}</span>
              </div>
            )}
          </div>

          {/* Body Preview */}
          {issue.bodyPreview && (
            <p className="mt-2 text-xs text-muted-foreground line-clamp-2 ml-6">
              {issue.bodyPreview}
            </p>
          )}

          {/* Labels */}
          {issue.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1 ml-6">
              {issue.labels.slice(0, 5).map((label) => (
                <span
                  key={label.name}
                  className="px-1.5 py-0.5 text-[10px] rounded-full"
                  style={{
                    backgroundColor: `#${label.color}20`,
                    color: `#${label.color}`,
                    border: `1px solid #${label.color}40`,
                  }}
                >
                  {label.name}
                </span>
              ))}
              {issue.labels.length > 5 && (
                <span className="text-[10px] text-muted-foreground">
                  +{issue.labels.length - 5}
                </span>
              )}
            </div>
          )}

          {/* Meta Row */}
          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground ml-6">
            {/* Author */}
            {issue.author && (
              <div className="flex items-center gap-1">
                {issue.author.avatarUrl ? (
                  <Image
                    src={issue.author.avatarUrl}
                    alt={issue.author.login}
                    width={14}
                    height={14}
                    className="w-3.5 h-3.5 rounded-full"
                  />
                ) : (
                  <User className="w-3 h-3" />
                )}
                <span>{issue.author.login}</span>
              </div>
            )}

            {/* Assignees */}
            {issue.assignees.length > 0 && (
              <div className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                <span>
                  {issue.assignees.length === 1
                    ? issue.assignees[0].login
                    : `${issue.assignees.length} assignees`}
                </span>
              </div>
            )}

            {/* Milestone */}
            {issue.milestone && (
              <div className="flex items-center gap-1">
                <Milestone className="w-3 h-3" />
                <span>{issue.milestone.title}</span>
              </div>
            )}

            {/* Updated Time */}
            <span className="ml-auto">
              {formatRelativeTime(issue.updatedAt)}
            </span>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => onOpenInGitHub(issue.htmlUrl)}>
          <ExternalLink className="w-3.5 h-3.5 mr-2" />
          Open on GitHub
        </ContextMenuItem>
        {onCreateWorktree && (
          <ContextMenuItem onClick={() => onCreateWorktree(issue)}>
            <GitBranch className="w-3.5 h-3.5 mr-2" />
            Create Worktree
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCopyUrl(issue.htmlUrl)}>
          <Copy className="w-3.5 h-3.5 mr-2" />
          Copy URL
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}