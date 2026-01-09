/**
 * Loop Detector - Detects infinite loops and stalled progress.
 *
 * Detection methods:
 * 1. Scrollback hash repetition (same output for N consecutive checks)
 * 2. Command pattern repetition (same sequence of commands)
 * 3. Progress stall (no meaningful changes despite activity)
 */

import type { OverseerIssue } from "@/domain/entities/OverseerCheck";
import type { DetectorContext, DetectorResult, PatternDetector } from "./types";

export const loopDetector: PatternDetector = {
  name: "loop-detector",

  detect(context: DetectorContext): DetectorResult {
    const issues: OverseerIssue[] = [];
    const { observations, history, config } = context;

    // Need enough history to detect loops
    if (history.length < config.loopDetectionWindow - 1) {
      return { detected: false, issues: [] };
    }

    // Check 1: Scrollback hash repetition
    const hashIssue = detectScrollbackRepetition(
      observations,
      history,
      config.loopDetectionWindow
    );
    if (hashIssue) issues.push(hashIssue);

    // Check 2: Command pattern repetition
    const commandIssue = detectCommandRepetition(observations, history);
    if (commandIssue) issues.push(commandIssue);

    // Check 3: Progress stall (no files modified in extended period)
    const stallIssue = detectProgressStall(observations, history);
    if (stallIssue) issues.push(stallIssue);

    return {
      detected: issues.length > 0,
      issues,
    };
  },
};

/**
 * Detect if scrollback hash has been the same for N consecutive checks.
 */
function detectScrollbackRepetition(
  current: { scrollbackHash: string },
  history: { scrollbackHash: string }[],
  window: number
): OverseerIssue | null {
  // Check if current hash matches all recent history
  const recentHistory = history.slice(-window + 1);
  if (recentHistory.length < window - 1) return null;

  const allSame = recentHistory.every(
    (h) => h.scrollbackHash === current.scrollbackHash
  );

  if (allSame) {
    return {
      type: "infinite_loop",
      severity: "high",
      description: `Terminal output unchanged for ${window} consecutive checks`,
      evidence: [
        `Hash: ${current.scrollbackHash.substring(0, 12)}...`,
        `Consecutive matches: ${window}`,
      ],
      confidence: 0.85,
    };
  }

  return null;
}

/**
 * Detect repeating command patterns.
 */
function detectCommandRepetition(
  current: { commandHistory: string[] },
  history: { commandHistory: string[] }[]
): OverseerIssue | null {
  // Need recent command history
  const allCommands = [
    ...history.flatMap((h) => h.commandHistory),
    ...current.commandHistory,
  ].slice(-20); // Last 20 commands

  if (allCommands.length < 6) return null;

  // Look for repeating patterns of length 2-4
  for (let patternLen = 2; patternLen <= 4; patternLen++) {
    const pattern = allCommands.slice(-patternLen);
    let repetitions = 1;

    // Count how many times this pattern repeats
    for (let i = allCommands.length - patternLen * 2; i >= 0; i -= patternLen) {
      const segment = allCommands.slice(i, i + patternLen);
      if (segment.join("|") === pattern.join("|")) {
        repetitions++;
      } else {
        break;
      }
    }

    if (repetitions >= 3) {
      return {
        type: "infinite_loop",
        severity: "high",
        description: `Repeating command pattern detected (${patternLen} commands × ${repetitions} times)`,
        evidence: [
          `Pattern: ${pattern.join(" → ")}`,
          `Repetitions: ${repetitions}`,
        ],
        confidence: 0.9,
      };
    }
  }

  return null;
}

/**
 * Detect progress stall (no files modified despite activity).
 */
function detectProgressStall(
  current: { filesModified: string[]; timeElapsed: number },
  history: { filesModified: string[]; timeElapsed: number }[]
): OverseerIssue | null {
  // Check if significant time has passed with no file modifications
  const timeThreshold = 600; // 10 minutes

  if (current.timeElapsed < timeThreshold) return null;

  // Count unique files modified across all history
  const allFiles = new Set<string>();
  history.forEach((h) => h.filesModified.forEach((f) => allFiles.add(f)));
  current.filesModified.forEach((f) => allFiles.add(f));

  // If we have history and minimal file changes, it might be stalled
  if (history.length >= 3 && allFiles.size < 2) {
    return {
      type: "stall_detected",
      severity: "medium",
      description: `Limited progress detected - only ${allFiles.size} files modified in ${Math.round(current.timeElapsed / 60)} minutes`,
      evidence: [
        `Time elapsed: ${Math.round(current.timeElapsed / 60)} minutes`,
        `Files modified: ${allFiles.size}`,
        `Checks performed: ${history.length + 1}`,
      ],
      confidence: 0.7,
    };
  }

  return null;
}
