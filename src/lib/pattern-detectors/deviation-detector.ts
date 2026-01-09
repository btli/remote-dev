/**
 * Deviation Detector - Detects when agent strays from the task.
 *
 * Detection methods:
 * 1. Working on unrelated files
 * 2. Commands don't match task type
 * 3. Context filling with irrelevant content
 */

import type { OverseerIssue } from "@/domain/entities/OverseerCheck";
import type { DetectorContext, DetectorResult, PatternDetector } from "./types";

export const deviationDetector: PatternDetector = {
  name: "deviation-detector",

  detect(context: DetectorContext): DetectorResult {
    const issues: OverseerIssue[] = [];
    const { observations, taskDescription, taskType } = context;

    // Check 1: Unrelated file modifications
    const fileIssue = detectUnrelatedFiles(
      observations.filesModified,
      taskDescription
    );
    if (fileIssue) issues.push(fileIssue);

    // Check 2: Command mismatch for task type
    const commandIssue = detectCommandMismatch(
      observations.commandHistory,
      taskType
    );
    if (commandIssue) issues.push(commandIssue);

    return {
      detected: issues.length > 0,
      issues,
    };
  },
};

/**
 * Detect if files being modified seem unrelated to the task.
 */
function detectUnrelatedFiles(
  filesModified: string[],
  taskDescription: string
): OverseerIssue | null {
  if (filesModified.length === 0) return null;

  // Extract keywords from task description
  const taskKeywords = extractKeywords(taskDescription);
  if (taskKeywords.length === 0) return null;

  // Check what percentage of files relate to task keywords
  let relatedCount = 0;
  const unrelatedFiles: string[] = [];

  for (const file of filesModified) {
    const fileName = file.toLowerCase();
    const isRelated = taskKeywords.some(
      (keyword) =>
        fileName.includes(keyword) ||
        // Also check directory structure
        file.split("/").some((part) => part.toLowerCase().includes(keyword))
    );

    if (isRelated) {
      relatedCount++;
    } else {
      unrelatedFiles.push(file);
    }
  }

  // If more than 50% of files seem unrelated, flag it
  const unrelatedRatio = unrelatedFiles.length / filesModified.length;
  if (unrelatedRatio > 0.5 && unrelatedFiles.length >= 3) {
    return {
      type: "task_deviation",
      severity: "medium",
      description: `Agent may be working on unrelated files (${Math.round(unrelatedRatio * 100)}% don't match task context)`,
      evidence: [
        `Task keywords: ${taskKeywords.slice(0, 5).join(", ")}`,
        `Unrelated files: ${unrelatedFiles.slice(0, 3).join(", ")}${unrelatedFiles.length > 3 ? `... (+${unrelatedFiles.length - 3} more)` : ""}`,
        `Related: ${relatedCount}/${filesModified.length} files`,
      ],
      confidence: 0.65,
    };
  }

  return null;
}

/**
 * Detect if commands don't match the expected task type.
 */
function detectCommandMismatch(
  commandHistory: string[],
  taskType: string
): OverseerIssue | null {
  if (commandHistory.length < 5) return null;

  // Define expected command patterns by task type
  const expectedPatterns: Record<string, RegExp[]> = {
    feature: [
      /git|npm|yarn|bun|pnpm/i,
      /test|jest|vitest|mocha/i,
      /build|compile/i,
    ],
    bug: [
      /git|log|grep|find/i,
      /test|jest|vitest/i,
      /debug|trace/i,
    ],
    refactor: [
      /git|sed|awk|grep/i,
      /test|lint|format/i,
    ],
    test: [
      /test|jest|vitest|mocha|pytest/i,
      /coverage|report/i,
    ],
    docs: [
      /git|doc|md|readme/i,
      /generate|build/i,
    ],
  };

  const patterns = expectedPatterns[taskType.toLowerCase()];
  if (!patterns) return null;

  // Check recent commands against expected patterns
  const recentCommands = commandHistory.slice(-10);
  let matchCount = 0;

  for (const cmd of recentCommands) {
    if (patterns.some((pattern) => pattern.test(cmd))) {
      matchCount++;
    }
  }

  // If less than 20% of commands match expected patterns, flag it
  const matchRatio = matchCount / recentCommands.length;
  if (matchRatio < 0.2 && recentCommands.length >= 5) {
    return {
      type: "task_deviation",
      severity: "low",
      description: `Commands may not match ${taskType} task type (${Math.round(matchRatio * 100)}% match expected patterns)`,
      evidence: [
        `Task type: ${taskType}`,
        `Recent commands: ${recentCommands.slice(0, 3).join(", ")}`,
        `Expected pattern match: ${matchCount}/${recentCommands.length}`,
      ],
      confidence: 0.5,
    };
  }

  return null;
}

/**
 * Extract keywords from task description.
 */
function extractKeywords(description: string): string[] {
  // Remove common words and extract meaningful keywords
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "or", "and", "but",
    "if", "then", "else", "when", "up", "down", "out", "off", "over",
    "under", "again", "further", "once", "here", "there", "all", "each",
    "few", "more", "most", "other", "some", "such", "no", "not", "only",
    "own", "same", "so", "than", "too", "very", "just", "also", "now",
    "add", "fix", "update", "implement", "create", "remove", "change",
    "make", "get", "set", "use", "new", "old", "bug", "feature", "issue",
  ]);

  const words = description
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));

  // Return unique keywords
  return [...new Set(words)];
}
