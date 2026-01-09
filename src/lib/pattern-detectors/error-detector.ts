/**
 * Error Detector - Detects error spirals and repeated failures.
 *
 * Detection methods:
 * 1. Error count threshold exceeded
 * 2. Error count increasing over time
 * 3. Same error repeating (not learning from mistakes)
 */

import type { OverseerIssue } from "@/domain/entities/OverseerCheck";
import type { DetectorContext, DetectorResult, PatternDetector } from "./types";

export const errorDetector: PatternDetector = {
  name: "error-detector",

  detect(context: DetectorContext): DetectorResult {
    const issues: OverseerIssue[] = [];
    const { observations, history, config } = context;

    // Check 1: Error threshold
    const thresholdIssue = detectErrorThreshold(
      observations,
      config.errorThreshold
    );
    if (thresholdIssue) issues.push(thresholdIssue);

    // Check 2: Error acceleration (errors increasing)
    const accelerationIssue = detectErrorAcceleration(observations, history);
    if (accelerationIssue) issues.push(accelerationIssue);

    // Check 3: Repeated errors (same error pattern)
    // Note: This would require parsing actual error messages from scrollback
    // For now, we detect based on error count patterns

    return {
      detected: issues.length > 0,
      issues,
    };
  },
};

/**
 * Detect if error count exceeds threshold.
 */
function detectErrorThreshold(
  observations: { errorCount: number },
  threshold: number
): OverseerIssue | null {
  const { errorCount } = observations;

  if (errorCount >= threshold) {
    return {
      type: "error_spiral",
      severity: "critical",
      description: `Error threshold exceeded: ${errorCount} errors (limit: ${threshold})`,
      evidence: [
        `Total errors: ${errorCount}`,
        `Threshold: ${threshold}`,
        `Excess: ${errorCount - threshold} errors`,
      ],
      confidence: 1.0,
    };
  }

  // Warning at 70% of threshold
  if (errorCount >= threshold * 0.7) {
    return {
      type: "error_spiral",
      severity: "medium",
      description: `Approaching error limit: ${errorCount} errors (${Math.round((errorCount / threshold) * 100)}% of threshold)`,
      evidence: [
        `Total errors: ${errorCount}`,
        `Threshold: ${threshold}`,
        `Remaining: ${threshold - errorCount} until limit`,
      ],
      confidence: 0.9,
    };
  }

  return null;
}

/**
 * Detect if errors are accelerating (more errors over time).
 */
function detectErrorAcceleration(
  current: { errorCount: number },
  history: { errorCount: number }[]
): OverseerIssue | null {
  // Need at least 3 data points
  if (history.length < 3) return null;

  // Check if errors are consistently increasing
  const recentHistory = history.slice(-5);
  let increasingCount = 0;

  for (let i = 1; i < recentHistory.length; i++) {
    if (recentHistory[i].errorCount > recentHistory[i - 1].errorCount) {
      increasingCount++;
    }
  }

  // Also check current vs last
  const lastCount = recentHistory[recentHistory.length - 1]?.errorCount ?? 0;
  if (current.errorCount > lastCount) {
    increasingCount++;
  }

  // If errors increased in most checks, flag as spiral
  const totalChecks = recentHistory.length;
  if (increasingCount >= Math.ceil(totalChecks * 0.8)) {
    // Calculate rate of error increase
    const firstErrors = recentHistory[0]?.errorCount ?? 0;
    const errorDelta = current.errorCount - firstErrors;

    return {
      type: "error_spiral",
      severity: "high",
      description: `Error spiral detected: errors increasing consistently (${firstErrors} → ${current.errorCount})`,
      evidence: [
        `Initial errors: ${firstErrors}`,
        `Current errors: ${current.errorCount}`,
        `Increase: +${errorDelta} errors`,
        `Increasing in: ${increasingCount}/${totalChecks} checks`,
      ],
      confidence: 0.85,
    };
  }

  return null;
}
