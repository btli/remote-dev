"use client";

/**
 * IssueDetailModal - Full detail view for a single GitHub issue or PR.
 *
 * Shows the full markdown body, labels, assignees, milestone,
 * comment count, and timestamps. Provides actions to open on
 * GitHub or create a worktree.
 */

import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { cn, formatRelativeTime } from "@/lib/utils";
import { REMARK_PLUGINS, MARKDOWN_COMPONENTS } from "./markdown-components";
import {
  ExternalLink,
  GitBranch,
  MessageSquare,
  Milestone,
  User,
  Users,
  Calendar,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { GitHubIssueDTO } from "@/contexts/GitHubIssuesContext";
import { getIssueIcon } from "./issue-icons";

interface IssueDetailModalProps {
  open: boolean;
  onClose: () => void;
  issue: GitHubIssueDTO | null;
  onCreateWorktree?: (issue: GitHubIssueDTO) => void;
}

export function IssueDetailModal({
  open,
  onClose,
  issue,
  onCreateWorktree,
}: IssueDetailModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        {open && issue && (
          <IssueDetailContent
            issue={issue}
            onCreateWorktree={onCreateWorktree}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface IssueDetailContentProps {
  issue: GitHubIssueDTO;
  onCreateWorktree?: (issue: GitHubIssueDTO) => void;
}

function IssueDetailContent({
  issue,
  onCreateWorktree,
}: IssueDetailContentProps) {
  const typeLabel = issue.isPullRequest ? "Pull Request" : "Issue";

  return (
    <>
      <DialogHeader className="shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            {getIssueIcon(issue, "w-5 h-5")}
            <div className="min-w-0">
              <DialogTitle className="text-base leading-snug">
                {issue.title}
              </DialogTitle>
              <DialogDescription className="text-xs mt-1 flex items-center gap-2 flex-wrap">
                <span className="font-medium text-primary">
                  #{issue.number}
                </span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                    issue.state === "open"
                      ? "bg-chart-2/20 text-chart-2"
                      : "bg-purple-500/20 text-purple-500"
                  )}
                >
                  {issue.state === "open" ? "Open" : "Closed"}
                </span>
                <span>{typeLabel}</span>
                {issue.author && (
                  <span className="flex items-center gap-1">
                    by
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
                    {issue.author.login}
                  </span>
                )}
              </DialogDescription>
            </div>
          </div>

          {/* Actions - pr-8 to clear the dialog close button */}
          <div className="flex items-center gap-1.5 shrink-0 pr-8">
            {onCreateWorktree && issue.state === "open" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCreateWorktree(issue)}
                className="text-xs"
              >
                <GitBranch className="w-3.5 h-3.5 mr-1" />
                Worktree
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(issue.htmlUrl, "_blank", "noopener,noreferrer")
              }
              className="text-xs"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1" />
              GitHub
            </Button>
          </div>
        </div>
      </DialogHeader>

      {/* Metadata */}
      <div className="shrink-0 flex flex-wrap items-center gap-3 text-xs text-muted-foreground border-b border-border pb-3">
        {/* Labels */}
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
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

        {/* Assignees */}
        {issue.assignees.length > 0 && (
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {issue.assignees.map((a) => (
              <span key={a.login} className="flex items-center gap-0.5">
                {a.avatarUrl ? (
                  <Image
                    src={a.avatarUrl}
                    alt={a.login}
                    width={14}
                    height={14}
                    className="w-3.5 h-3.5 rounded-full"
                  />
                ) : null}
                {a.login}
              </span>
            ))}
          </div>
        )}

        {/* Milestone */}
        {issue.milestone && (
          <div className="flex items-center gap-1">
            <Milestone className="w-3 h-3" />
            {issue.milestone.title}
          </div>
        )}

        {/* Comments */}
        {issue.comments > 0 && (
          <div className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {issue.comments} comment{issue.comments !== 1 ? "s" : ""}
          </div>
        )}

        {/* Dates */}
        <div className="flex items-center gap-1 ml-auto">
          <Calendar className="w-3 h-3" />
          Created {formatRelativeTime(issue.createdAt)}
          {issue.updatedAt !== issue.createdAt && (
            <span className="text-muted-foreground/70">
              &middot; Updated {formatRelativeTime(issue.updatedAt)}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="pr-4">
          {issue.body ? (
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              components={MARKDOWN_COMPONENTS}
            >
              {issue.body}
            </ReactMarkdown>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No description provided.
            </p>
          )}
        </div>
      </ScrollArea>
    </>
  );
}
