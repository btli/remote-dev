/**
 * Cost Detector - Detects budget overruns and spending acceleration.
 *
 * Detection methods:
 * 1. Absolute cost threshold exceeded
 * 2. Time threshold exceeded
 * 3. Cost acceleration (spending faster than expected)
 */

import type { OverseerIssue } from "@/domain/entities/OverseerCheck";
import type { DetectorContext, DetectorResult, PatternDetector } from "./types";

export const costDetector: PatternDetector = {
  name: "cost-detector",

  detect(context: DetectorContext): DetectorResult {
    const issues: OverseerIssue[] = [];
    const { observations, history, config } = context;

    // Check 1: Cost threshold
    const costIssue = detectCostOverrun(observations, config.maxCostPerTask);
    if (costIssue) issues.push(costIssue);

    // Check 2: Time threshold
    const timeIssue = detectTimeOverrun(observations, config.maxTimePerTask);
    if (timeIssue) issues.push(timeIssue);

    // Check 3: Cost acceleration
    const accelerationIssue = detectCostAcceleration(observations, history);
    if (accelerationIssue) issues.push(accelerationIssue);

    return {
      detected: issues.length > 0,
      issues,
    };
  },
};

/**
 * Detect if cost exceeds the configured maximum.
 */
function detectCostOverrun(
  observations: { costAccumulated: number },
  maxCost: number
): OverseerIssue | null {
  const { costAccumulated } = observations;

  if (costAccumulated >= maxCost) {
    return {
      type: "cost_runaway",
      severity: "critical",
      description: `Cost threshold exceeded: $${costAccumulated.toFixed(2)} of $${maxCost} budget`,
      evidence: [
        `Accumulated cost: $${costAccumulated.toFixed(2)}`,
        `Budget limit: $${maxCost}`,
        `Over budget: $${(costAccumulated - maxCost).toFixed(2)}`,
      ],
      confidence: 1.0,
    };
  }

  // Warning at 80% of budget
  if (costAccumulated >= maxCost * 0.8) {
    return {
      type: "cost_runaway",
      severity: "medium",
      description: `Approaching cost limit: $${costAccumulated.toFixed(2)} (${Math.round((costAccumulated / maxCost) * 100)}% of budget)`,
      evidence: [
        `Accumulated cost: $${costAccumulated.toFixed(2)}`,
        `Budget limit: $${maxCost}`,
        `Remaining: $${(maxCost - costAccumulated).toFixed(2)}`,
      ],
      confidence: 0.95,
    };
  }

  return null;
}

/**
 * Detect if time exceeds the configured maximum.
 */
function detectTimeOverrun(
  observations: { timeElapsed: number },
  maxTime: number
): OverseerIssue | null {
  const { timeElapsed } = observations;

  if (timeElapsed >= maxTime) {
    return {
      type: "time_runaway",
      severity: "critical",
      description: `Time limit exceeded: ${formatDuration(timeElapsed)} of ${formatDuration(maxTime)} limit`,
      evidence: [
        `Time elapsed: ${formatDuration(timeElapsed)}`,
        `Time limit: ${formatDuration(maxTime)}`,
        `Over limit: ${formatDuration(timeElapsed - maxTime)}`,
      ],
      confidence: 1.0,
    };
  }

  // Warning at 80% of time limit
  if (timeElapsed >= maxTime * 0.8) {
    return {
      type: "time_runaway",
      severity: "medium",
      description: `Approaching time limit: ${formatDuration(timeElapsed)} (${Math.round((timeElapsed / maxTime) * 100)}% of limit)`,
      evidence: [
        `Time elapsed: ${formatDuration(timeElapsed)}`,
        `Time limit: ${formatDuration(maxTime)}`,
        `Remaining: ${formatDuration(maxTime - timeElapsed)}`,
      ],
      confidence: 0.95,
    };
  }

  return null;
}

/**
 * Detect if costs are accelerating (spending faster over time).
 */
function detectCostAcceleration(
  current: { costAccumulated: number; timeElapsed: number },
  history: { costAccumulated: number; timeElapsed: number }[]
): OverseerIssue | null {
  // Need at least 3 data points
  if (history.length < 2) return null;

  // Calculate cost rates over different windows
  const recentHistory = history.slice(-3);

  // Calculate rate for first half vs second half
  const firstCost = recentHistory[0]?.costAccumulated ?? 0;
  const firstTime = recentHistory[0]?.timeElapsed ?? 0;

  const midIdx = Math.floor(recentHistory.length / 2);
  const midCost = recentHistory[midIdx]?.costAccumulated ?? 0;
  const midTime = recentHistory[midIdx]?.timeElapsed ?? 0;

  const lastCost = current.costAccumulated;
  const lastTime = current.timeElapsed;

  // Calculate rates ($ per minute)
  const firstRate =
    midTime > firstTime ? (midCost - firstCost) / ((midTime - firstTime) / 60) : 0;
  const secondRate =
    lastTime > midTime ? (lastCost - midCost) / ((lastTime - midTime) / 60) : 0;

  // If second rate is significantly higher (2x+), flag as acceleration
  if (firstRate > 0 && secondRate > firstRate * 2) {
    return {
      type: "cost_runaway",
      severity: "high",
      description: `Cost acceleration detected: spending rate increased from $${firstRate.toFixed(2)}/min to $${secondRate.toFixed(2)}/min`,
      evidence: [
        `Initial rate: $${firstRate.toFixed(2)}/min`,
        `Current rate: $${secondRate.toFixed(2)}/min`,
        `Acceleration: ${(secondRate / firstRate).toFixed(1)}x`,
      ],
      confidence: 0.8,
    };
  }

  return null;
}

/**
 * Format duration in seconds to human-readable string.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
