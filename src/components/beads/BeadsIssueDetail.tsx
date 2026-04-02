"use client";

/**
 * BeadsIssueDetail - Slide-in detail panel for a selected beads issue.
 *
 * Shows issue metadata, description, dependencies, labels, audit trail,
 * and comments. Rendered inside the BeadsSidebar when an issue is selected.
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  Clock,
  User,
  Loader2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type {
  BeadsIssue,
  BeadsComment,
  BeadsEvent,
} from "@/types/beads";
import { BeadsDependencyTree } from "./BeadsDependencyTree";
import {
  ISSUE_TYPE_ICONS,
  ISSUE_TYPE_COLORS,
  STATUS_BADGE_STYLES,
  PRIORITY_BADGE_STYLES,
  shortenId,
} from "./beads-constants";
import { CheckSquare } from "lucide-react";

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hydrateComment(raw: Record<string, unknown>): BeadsComment {
  return {
    ...(raw as unknown as BeadsComment),
    createdAt: new Date(raw.createdAt as string),
  };
}

function hydrateEvent(raw: Record<string, unknown>): BeadsEvent {
  return {
    ...(raw as unknown as BeadsEvent),
    createdAt: new Date(raw.createdAt as string),
  };
}

interface BeadsIssueDetailProps {
  issue: BeadsIssue;
  allIssues: BeadsIssue[];
  projectPath: string;
  onNavigateToIssue: (issueId: string) => void;
}

export function BeadsIssueDetail({
  issue,
  allIssues,
  projectPath,
  onNavigateToIssue,
}: BeadsIssueDetailProps) {
  const TypeIcon = ISSUE_TYPE_ICONS[issue.issueType] ?? CheckSquare;
  const typeColor = ISSUE_TYPE_COLORS[issue.issueType] ?? "text-muted-foreground";
  const statusStyle = STATUS_BADGE_STYLES[issue.status] ?? STATUS_BADGE_STYLES.open;
  const priorityStyle =
    PRIORITY_BADGE_STYLES[issue.priority] ?? PRIORITY_BADGE_STYLES[4];

  const shortId = shortenId(issue.id);

  // Comments and events (fetched on mount)
  const [comments, setComments] = useState<BeadsComment[]>([]);
  const [events, setEvents] = useState<BeadsEvent[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Section collapse state
  const [descriptionExpanded, setDescriptionExpanded] = useState(true);
  const [depsExpanded, setDepsExpanded] = useState(true);
  const [auditExpanded, setAuditExpanded] = useState(false);
  const [commentsExpanded, setCommentsExpanded] = useState(true);

  // Fetch comments and events when issue changes
  useEffect(() => {
    let cancelled = false;

    async function fetchDetails() {
      setLoadingDetails(true);
      try {
        const res = await fetch(
          `/api/beads/${encodeURIComponent(issue.id)}/comments?includeEvents=true&projectPath=${encodeURIComponent(projectPath)}`
        );

        if (!cancelled) {
          if (res.ok) {
            const data = await res.json();
            setComments(
              Array.isArray(data.comments) ? data.comments.map(hydrateComment) : []
            );
            setEvents(
              Array.isArray(data.events) ? data.events.map(hydrateEvent) : []
            );
          } else {
            setComments([]);
            setEvents([]);
          }
        }
      } catch {
        if (!cancelled) {
          setComments([]);
          setEvents([]);
        }
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    }

    fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [issue.id, projectPath]);

  const hasDeps = issue.dependencies.length > 0 || issue.dependents.length > 0;

  return (
    <ScrollArea className="flex-1">
      <div className="px-3 py-3 space-y-3">
        {/* Issue header */}
        <div className="space-y-2">
          {/* ID + type */}
          <div className="flex items-center gap-2">
            <TypeIcon className={cn("w-4 h-4", typeColor)} />
            <span className="text-[11px] font-mono text-muted-foreground">
              {shortId}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold text-foreground leading-snug">
            {issue.title}
          </h3>

          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="secondary"
              className={cn("text-[10px] px-1.5 py-0", statusStyle)}
            >
              {issue.status.replace("_", " ")}
            </Badge>
            <Badge
              variant="secondary"
              className={cn("text-[10px] px-1.5 py-0", priorityStyle)}
            >
              P{issue.priority}
            </Badge>
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0"
            >
              {issue.issueType}
            </Badge>
          </div>

          {/* Metadata */}
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {issue.assignee && (
              <div className="flex items-center gap-1.5">
                <User className="w-3 h-3" />
                <span>Assigned to {issue.assignee}</span>
              </div>
            )}
            {issue.owner && (
              <div className="flex items-center gap-1.5">
                <User className="w-3 h-3" />
                <span>Owner: {issue.owner}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              <span>Created {formatDate(issue.createdAt)}</span>
            </div>
            {issue.closedAt && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                <span>
                  Closed {formatDate(issue.closedAt)}
                  {issue.closeReason && ` (${issue.closeReason})`}
                </span>
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Description */}
        <div>
          <button
            onClick={() => setDescriptionExpanded(!descriptionExpanded)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {descriptionExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Description
          </button>
          {descriptionExpanded && (
            <div className="mt-1.5 pl-4">
              {issue.description ? (
                <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                  {issue.description}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground italic">
                  No description
                </p>
              )}

              {/* Design notes */}
              {issue.design && (
                <div className="mt-2">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Design
                  </span>
                  <p className="text-xs text-foreground whitespace-pre-wrap mt-0.5">
                    {issue.design}
                  </p>
                </div>
              )}

              {/* Acceptance criteria */}
              {issue.acceptanceCriteria && (
                <div className="mt-2">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Acceptance Criteria
                  </span>
                  <p className="text-xs text-foreground whitespace-pre-wrap mt-0.5">
                    {issue.acceptanceCriteria}
                  </p>
                </div>
              )}

              {/* Notes */}
              {issue.notes && (
                <div className="mt-2">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Notes
                  </span>
                  <p className="text-xs text-foreground whitespace-pre-wrap mt-0.5">
                    {issue.notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Labels */}
        {issue.labels.length > 0 && (
          <>
            <Separator />
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Labels
              </span>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {issue.labels.map((label) => (
                  <Badge
                    key={label}
                    variant="outline"
                    className="text-[10px] px-1.5 py-0"
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Dependencies */}
        {hasDeps && (
          <>
            <Separator />
            <div>
              <button
                onClick={() => setDepsExpanded(!depsExpanded)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                {depsExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <GitBranch className="w-3 h-3" />
                Dependencies
                <span className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded">
                  {issue.dependencies.length + issue.dependents.length}
                </span>
              </button>
              {depsExpanded && (
                <div className="mt-1.5 pl-2">
                  <BeadsDependencyTree
                    issue={issue}
                    allIssues={allIssues}
                    onNavigateToIssue={onNavigateToIssue}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {/* Comments */}
        <>
          <Separator />
          <div>
            <button
              onClick={() => setCommentsExpanded(!commentsExpanded)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              {commentsExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <MessageSquare className="w-3 h-3" />
              Comments
              {comments.length > 0 && (
                <span className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded">
                  {comments.length}
                </span>
              )}
            </button>
            {commentsExpanded && (
              <div className="mt-1.5 space-y-2 pl-2">
                {loadingDetails ? (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">
                      Loading...
                    </span>
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic py-1">
                    No comments
                  </p>
                ) : (
                  comments.map((comment) => (
                    <div
                      key={comment.id}
                      className="rounded-md bg-muted/50 px-2.5 py-2 space-y-1"
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <User className="w-2.5 h-2.5" />
                        <span className="font-medium">{comment.author}</span>
                        <span>{formatDate(comment.createdAt)}</span>
                      </div>
                      <p className="text-xs text-foreground whitespace-pre-wrap">
                        {comment.text}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </>

        {/* Audit trail */}
        <>
          <Separator />
          <div>
            <button
              onClick={() => setAuditExpanded(!auditExpanded)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              {auditExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <Clock className="w-3 h-3" />
              Audit Trail
              {events.length > 0 && (
                <span className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded">
                  {events.length}
                </span>
              )}
            </button>
            {auditExpanded && (
              <div className="mt-1.5 space-y-1 pl-2">
                {loadingDetails ? (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">
                      Loading...
                    </span>
                  </div>
                ) : events.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic py-1">
                    No events
                  </p>
                ) : (
                  events.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start gap-1.5 text-[11px] py-0.5"
                    >
                      <Clock className="w-2.5 h-2.5 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <span className="text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {event.actor}
                          </span>{" "}
                          {event.eventType}
                          {event.oldValue && event.newValue && (
                            <>
                              {" "}
                              <span className="line-through text-muted-foreground/50">
                                {event.oldValue}
                              </span>{" "}
                              &rarr;{" "}
                              <span className="text-foreground">
                                {event.newValue}
                              </span>
                            </>
                          )}
                        </span>
                        {event.comment && (
                          <p className="text-muted-foreground mt-0.5 italic">
                            {event.comment}
                          </p>
                        )}
                        <span className="text-[10px] text-muted-foreground/50">
                          {formatDate(event.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </>
      </div>
    </ScrollArea>
  );
}
