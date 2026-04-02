/**
 * Shared constants for beads UI components.
 */

import {
  Bug,
  Sparkles,
  CheckSquare,
  Layers,
  Wrench,
  MessageSquare,
} from "lucide-react";
import type { BeadsIssueType, BeadsStatus } from "@/types/beads";

export const PRIORITY_COLORS: Record<number, string> = {
  0: "bg-red-500",
  1: "bg-orange-500",
  2: "bg-yellow-500",
  3: "bg-blue-400",
  4: "bg-gray-500",
};

export const PRIORITY_BADGE_STYLES: Record<number, string> = {
  0: "bg-red-500/20 text-red-500",
  1: "bg-orange-500/20 text-orange-500",
  2: "bg-yellow-500/20 text-yellow-500",
  3: "bg-blue-400/20 text-blue-400",
  4: "bg-gray-500/20 text-gray-500",
};

export const ISSUE_TYPE_ICONS: Record<BeadsIssueType, React.ElementType> = {
  bug: Bug,
  feature: Sparkles,
  task: CheckSquare,
  epic: Layers,
  chore: Wrench,
  message: MessageSquare,
};

export const ISSUE_TYPE_COLORS: Record<BeadsIssueType, string> = {
  bug: "text-red-400",
  feature: "text-purple-400",
  task: "text-blue-400",
  epic: "text-amber-400",
  chore: "text-gray-400",
  message: "text-teal-400",
};

export const STATUS_COLORS: Record<BeadsStatus, string> = {
  open: "text-muted-foreground",
  in_progress: "text-chart-2",
  closed: "text-green-500",
  deferred: "text-muted-foreground/50",
};

export const STATUS_BADGE_STYLES: Record<BeadsStatus, string> = {
  open: "bg-muted text-muted-foreground",
  in_progress: "bg-chart-2/20 text-chart-2",
  closed: "bg-green-500/20 text-green-500",
  deferred: "bg-muted text-muted-foreground/50",
};

/** Truncate a beads issue ID for display. */
export function shortenId(id: string, maxLen = 12): string {
  return id.length > maxLen ? id.slice(0, maxLen) : id;
}
