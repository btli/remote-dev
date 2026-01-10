"use client";

/**
 * useLearningNotifications - Show toast notifications for learning events.
 *
 * Provides functions to show toasts when:
 * - New conventions are learned
 * - New patterns are discovered
 * - Skills are suggested
 * - Tools are recommended
 */

import { toast } from "sonner";
import { BookOpen, Lightbulb, Code2, Wrench } from "lucide-react";
import type { ReactNode } from "react";

interface LearningResult {
  conventionsAdded: number;
  patternsAdded: number;
  skillsAdded: number;
  toolsAdded: number;
  folderName?: string;
}

/**
 * Show a toast summarizing learning extraction results.
 */
export function showLearningToast(result: LearningResult): void {
  const { conventionsAdded, patternsAdded, skillsAdded, toolsAdded, folderName } = result;

  const total = conventionsAdded + patternsAdded + skillsAdded + toolsAdded;

  if (total === 0) {
    return; // Don't show toast if nothing was learned
  }

  const parts: string[] = [];
  if (conventionsAdded > 0) {
    parts.push(`${conventionsAdded} convention${conventionsAdded > 1 ? "s" : ""}`);
  }
  if (patternsAdded > 0) {
    parts.push(`${patternsAdded} pattern${patternsAdded > 1 ? "s" : ""}`);
  }
  if (skillsAdded > 0) {
    parts.push(`${skillsAdded} skill${skillsAdded > 1 ? "s" : ""}`);
  }
  if (toolsAdded > 0) {
    parts.push(`${toolsAdded} tool${toolsAdded > 1 ? "s" : ""}`);
  }

  const description = formatParts(parts);
  const title = folderName
    ? `Learned from ${folderName}`
    : "New learnings extracted";

  toast.success(title, {
    description,
    duration: 5000,
  });
}

/**
 * Show a toast when learning extraction starts.
 */
export function showLearningStartToast(sessionName: string): string {
  return toast.loading(`Extracting learnings from ${sessionName}...`, {
    duration: Infinity,
  }) as string;
}

/**
 * Dismiss a specific toast.
 */
export function dismissToast(toastId: string): void {
  toast.dismiss(toastId);
}

/**
 * Show an error toast for learning failures.
 */
export function showLearningErrorToast(error: string): void {
  toast.error("Failed to extract learnings", {
    description: error,
    duration: 5000,
  });
}

/**
 * Format parts into a human-readable list.
 */
function formatParts(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;

  const last = parts.pop();
  return `${parts.join(", ")}, and ${last}`;
}
