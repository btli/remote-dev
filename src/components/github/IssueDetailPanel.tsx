"use client";

import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import Image from "next/image";
import {
  ArrowLeft,
  CircleDot,
  CircleCheck,
  ExternalLink,
  GitBranch,
  Loader2,
  Milestone,
  MessageSquare,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { GitHubIssueDTO } from "@/contexts/GitHubIssuesContext";

interface IssueComment {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string } | null;
}

interface IssueDetailPanelProps {
  issue: GitHubIssueDTO;
  repositoryId: string;
  onBack: () => void;
  onStartWorking: (issue: GitHubIssueDTO) => void;
  onOpenInGitHub: (url: string) => void;
}

export function IssueDetailPanel({
  issue,
  repositoryId,
  onBack,
  onStartWorking,
  onOpenInGitHub,
}: IssueDetailPanelProps) {
  const isOpen = issue.state === "open";
  const [isStarting, setIsStarting] = useState(false);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(issue.comments > 0);

  // Escape key navigates back to issue list
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onBack();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onBack]);

  // Fetch comments on mount
  useEffect(() => {
    if (issue.comments === 0) return;

    let cancelled = false;

    fetch(`/api/github/repositories/${repositoryId}/issues/${issue.number}/comments`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then((data) => {
        if (!cancelled) setComments(data.comments ?? []);
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to fetch comments:", err);
      })
      .finally(() => {
        if (!cancelled) setLoadingComments(false);
      });

    return () => { cancelled = true; };
  }, [repositoryId, issue.number, issue.comments]);

  const handleStartWorking = useCallback(() => {
    setIsStarting(true);
    onStartWorking(issue);
  }, [onStartWorking, issue]);

  const markdownClasses = "text-sm text-foreground/90 leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 [&_code]:font-mono [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded [&_pre]:text-xs [&_pre]:overflow-x-auto [&_pre]:my-2 [&_ul]:list-disc [&_ul]:ml-4 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:ml-4 [&_ol]:my-1 [&_li]:my-0.5 [&_p]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_a]:text-primary [&_a]:underline [&_img]:max-w-full [&_img]:rounded [&_hr]:my-3 [&_hr]:border-border";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 space-y-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Issues
        </button>

        <div className="flex items-start gap-2">
          {isOpen ? (
            <CircleDot className="w-5 h-5 text-chart-2 mt-0.5 shrink-0" />
          ) : (
            <CircleCheck className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-primary">
                #{issue.number}
              </span>
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded",
                  isOpen
                    ? "bg-chart-2/20 text-chart-2"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isOpen ? "Open" : "Closed"}
              </span>
            </div>
            <h3 className="text-base font-semibold text-foreground">
              {issue.title}
            </h3>
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground ml-7">
          {issue.author && (
            <div className="flex items-center gap-1">
              {issue.author.avatarUrl ? (
                <Image
                  src={issue.author.avatarUrl}
                  alt={issue.author.login}
                  width={16}
                  height={16}
                  className="w-4 h-4 rounded-full"
                />
              ) : (
                <User className="w-3.5 h-3.5" />
              )}
              <span>{issue.author.login}</span>
            </div>
          )}
          {issue.assignees.length > 0 && (
            <div className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              <span>
                {issue.assignees.map((a) => a.login).join(", ")}
              </span>
            </div>
          )}
          {issue.milestone && (
            <div className="flex items-center gap-1">
              <Milestone className="w-3.5 h-3.5" />
              <span>{issue.milestone.title}</span>
            </div>
          )}
          {issue.comments > 0 && (
            <div className="flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{issue.comments}</span>
            </div>
          )}
          <span className="ml-auto">
            {formatRelativeTime(issue.updatedAt)}
          </span>
        </div>

        {/* Labels */}
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 ml-7">
            {issue.labels.map((label) => (
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
          </div>
        )}

        {/* Suggested branch */}
        <div className="flex items-center gap-1.5 ml-7 text-xs text-muted-foreground">
          <GitBranch className="w-3.5 h-3.5" />
          <code className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
            {issue.suggestedBranchName}
          </code>
        </div>
      </div>

      {/* Body + Comments */}
      <ScrollArea className="flex-1 min-h-0 mt-4">
        <div className="pr-4 ml-7 space-y-6">
          {/* Issue Body */}
          {issue.body ? (
            <div className={markdownClasses}>
              <ReactMarkdown>{issue.body}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No description provided.
            </p>
          )}

          {/* Comments */}
          {issue.comments > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                Comments ({issue.comments})
              </h4>

              {loadingComments ? (
                <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading comments...
                </div>
              ) : (
                <div className="space-y-3">
                  {comments.map((comment) => (
                    <div
                      key={comment.id}
                      className="rounded-lg border border-border/50 p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {comment.user && (
                          <div className="flex items-center gap-1">
                            {comment.user.avatar_url ? (
                              <Image
                                src={comment.user.avatar_url}
                                alt={comment.user.login}
                                width={16}
                                height={16}
                                className="w-4 h-4 rounded-full"
                              />
                            ) : (
                              <User className="w-3 h-3" />
                            )}
                            <span className="font-medium text-foreground">
                              {comment.user.login}
                            </span>
                          </div>
                        )}
                        <span>{formatRelativeTime(comment.created_at)}</span>
                      </div>
                      <div className={markdownClasses}>
                        <ReactMarkdown>{comment.body}</ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-2 pt-4 border-t border-border mt-4">
        {isOpen && (
          <Button
            onClick={handleStartWorking}
            disabled={isStarting}
            size="sm"
            className="gap-1.5"
          >
            {isStarting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Wrench className="w-3.5 h-3.5" />
                Start Working
              </>
            )}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenInGitHub(issue.htmlUrl)}
          className="gap-1.5"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open in GitHub
        </Button>
      </div>
    </div>
  );
}
