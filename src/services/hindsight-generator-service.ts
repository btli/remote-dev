/**
 * Hindsight Generator Service - Auto-generate reflection notes from episode analysis
 *
 * Analyzes completed episodes to automatically populate EpisodeReflection fields:
 * - whatWorked: Identify successful patterns from trajectory
 * - whatFailed: Detect failures and their causes
 * - keyInsights: Extract learning from decisions and pivots
 * - wouldDoDifferently: Generate actionable suggestions from failure patterns
 *
 * Based on arXiv 2512.10398v5 requirements for hindsight learning.
 */

import {
  Episode,
  type EpisodeReflection,
  type Decision,
  type Pivot,
} from "@/domain/entities/Episode";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface HindsightAnalysis {
  whatWorked: string[];
  whatFailed: string[];
  keyInsights: string[];
  wouldDoDifferently: string;
  confidence: number; // 0-1, how confident we are in the analysis
  patterns: DetectedPattern[];
}

export interface DetectedPattern {
  type: PatternType;
  description: string;
  evidence: string[];
  severity: "info" | "warning" | "critical";
}

export type PatternType =
  | "repeated_failure" // Same action failing multiple times
  | "recovery_success" // Successfully recovered from errors
  | "pivot_effective" // Strategy change that led to success
  | "pivot_ineffective" // Strategy change that didn't help
  | "tool_mastery" // Consistent successful tool usage
  | "tool_struggle" // Repeated issues with specific tool
  | "quick_resolution" // Fast successful completion
  | "prolonged_attempt" // Long duration before success/failure
  | "error_cascade" // Multiple failures in sequence
  | "decision_quality"; // Analysis of decision outcomes

interface TrajectoryMetrics {
  totalActions: number;
  successfulActions: number;
  failedActions: number;
  totalDuration: number;
  avgActionDuration: number;
  errorRate: number;
  toolUsage: Map<string, { success: number; failure: number }>;
  consecutiveFailures: number;
  maxConsecutiveFailures: number;
  recoveryCount: number;
}

interface PivotAnalysis {
  effectivePivots: Pivot[];
  ineffectivePivots: Pivot[];
  errorTriggeredPivots: number;
  discoveryPivots: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const REPEATED_FAILURE_THRESHOLD = 3;
const HIGH_ERROR_RATE_THRESHOLD = 0.4;
const PROLONGED_DURATION_THRESHOLD = 300000; // 5 minutes
const QUICK_RESOLUTION_THRESHOLD = 60000; // 1 minute
const CONSECUTIVE_FAILURE_WARNING = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Main Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate hindsight reflection from a completed episode.
 */
export function generateHindsight(episode: Episode): HindsightAnalysis {
  const metrics = analyzeTrajectoryMetrics(episode);
  const pivotAnalysis = analyzePivots(episode);
  const patterns = detectPatterns(episode, metrics, pivotAnalysis);

  const whatWorked = extractWhatWorked(episode, metrics, pivotAnalysis, patterns);
  const whatFailed = extractWhatFailed(episode, metrics, patterns);
  const keyInsights = extractKeyInsights(episode, metrics, pivotAnalysis, patterns);
  const wouldDoDifferently = generateWouldDoDifferently(episode, metrics, patterns);

  // Calculate confidence based on evidence quality
  const confidence = calculateConfidence(episode, metrics, patterns);

  return {
    whatWorked,
    whatFailed,
    keyInsights,
    wouldDoDifferently,
    confidence,
    patterns,
  };
}

/**
 * Apply hindsight to an episode, returning a new episode with updated reflection.
 */
export function applyHindsight(episode: Episode): Episode {
  const hindsight = generateHindsight(episode);

  // Merge with existing reflection (don't overwrite user-provided data)
  const mergedReflection: EpisodeReflection = {
    whatWorked: mergeArrays(episode.reflection.whatWorked, hindsight.whatWorked),
    whatFailed: mergeArrays(episode.reflection.whatFailed, hindsight.whatFailed),
    keyInsights: mergeArrays(episode.reflection.keyInsights, hindsight.keyInsights),
    wouldDoDifferently:
      episode.reflection.wouldDoDifferently || hindsight.wouldDoDifferently,
    userRating: episode.reflection.userRating,
    userFeedback: episode.reflection.userFeedback,
  };

  return episode.withReflection(mergedReflection);
}

/**
 * Analyze multiple episodes to find cross-episode patterns.
 */
export function analyzeEpisodePatterns(episodes: Episode[]): {
  commonSuccessPatterns: string[];
  commonFailurePatterns: string[];
  recommendations: string[];
} {
  const successPatterns = new Map<string, number>();
  const failurePatterns = new Map<string, number>();

  for (const episode of episodes) {
    const hindsight = generateHindsight(episode);

    for (const pattern of hindsight.patterns) {
      if (pattern.severity === "info" || episode.isSuccess()) {
        const key = `${pattern.type}: ${pattern.description}`;
        successPatterns.set(key, (successPatterns.get(key) || 0) + 1);
      }
      if (pattern.severity !== "info" || episode.isFailed()) {
        const key = `${pattern.type}: ${pattern.description}`;
        failurePatterns.set(key, (failurePatterns.get(key) || 0) + 1);
      }
    }
  }

  // Sort by frequency
  const commonSuccessPatterns = Array.from(successPatterns.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern]) => pattern);

  const commonFailurePatterns = Array.from(failurePatterns.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern]) => pattern);

  // Generate recommendations from patterns
  const recommendations = generateCrossEpisodeRecommendations(
    commonSuccessPatterns,
    commonFailurePatterns
  );

  return {
    commonSuccessPatterns,
    commonFailurePatterns,
    recommendations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trajectory Analysis
// ─────────────────────────────────────────────────────────────────────────────

function analyzeTrajectoryMetrics(episode: Episode): TrajectoryMetrics {
  const actions = episode.getAllActions();
  const toolUsage = new Map<string, { success: number; failure: number }>();

  let successfulActions = 0;
  let failedActions = 0;
  let totalDuration = 0;
  let consecutiveFailures = 0;
  let maxConsecutiveFailures = 0;
  let recoveryCount = 0;
  let wasLastFailure = false;

  for (const action of actions) {
    totalDuration += action.duration;

    if (action.success) {
      successfulActions++;
      if (wasLastFailure && consecutiveFailures > 0) {
        recoveryCount++;
      }
      consecutiveFailures = 0;
      wasLastFailure = false;
    } else {
      failedActions++;
      consecutiveFailures++;
      maxConsecutiveFailures = Math.max(maxConsecutiveFailures, consecutiveFailures);
      wasLastFailure = true;
    }

    // Track tool-specific usage
    if (action.tool) {
      const toolStats = toolUsage.get(action.tool) || { success: 0, failure: 0 };
      if (action.success) {
        toolStats.success++;
      } else {
        toolStats.failure++;
      }
      toolUsage.set(action.tool, toolStats);
    }
  }

  return {
    totalActions: actions.length,
    successfulActions,
    failedActions,
    totalDuration,
    avgActionDuration: actions.length > 0 ? totalDuration / actions.length : 0,
    errorRate: actions.length > 0 ? failedActions / actions.length : 0,
    toolUsage,
    consecutiveFailures,
    maxConsecutiveFailures,
    recoveryCount,
  };
}

function analyzePivots(episode: Episode): PivotAnalysis {
  const pivots = episode.trajectory.pivots;
  const effectivePivots: Pivot[] = [];
  const ineffectivePivots: Pivot[] = [];
  let errorTriggeredPivots = 0;
  let discoveryPivots = 0;

  // To determine pivot effectiveness, we look at actions after the pivot
  const actions = episode.getAllActions();

  for (const pivot of pivots) {
    if (pivot.triggered_by === "error") {
      errorTriggeredPivots++;
    } else if (pivot.triggered_by === "discovery") {
      discoveryPivots++;
    }

    // Find actions after this pivot (use >= for same-timestamp edge case in tests)
    const pivotTime = pivot.timestamp.getTime();
    const actionsAfterPivot = actions.filter(
      (a) => a.timestamp.getTime() >= pivotTime
    );

    if (actionsAfterPivot.length > 0) {
      const successRate =
        actionsAfterPivot.filter((a) => a.success).length / actionsAfterPivot.length;

      if (successRate > 0.6 || episode.isSuccess()) {
        effectivePivots.push(pivot);
      } else {
        ineffectivePivots.push(pivot);
      }
    } else if (episode.isSuccess()) {
      // If no actions after pivot but episode succeeded, consider effective
      effectivePivots.push(pivot);
    }
  }

  return {
    effectivePivots,
    ineffectivePivots,
    errorTriggeredPivots,
    discoveryPivots,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Detection
// ─────────────────────────────────────────────────────────────────────────────

function detectPatterns(
  episode: Episode,
  metrics: TrajectoryMetrics,
  pivotAnalysis: PivotAnalysis
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Repeated failure pattern
  if (metrics.maxConsecutiveFailures >= REPEATED_FAILURE_THRESHOLD) {
    patterns.push({
      type: "repeated_failure",
      description: `${metrics.maxConsecutiveFailures} consecutive failures detected`,
      evidence: getConsecutiveFailureEvidence(episode),
      severity: metrics.maxConsecutiveFailures >= CONSECUTIVE_FAILURE_WARNING ? "critical" : "warning",
    });
  }

  // Recovery success pattern
  if (metrics.recoveryCount > 0 && episode.isSuccess()) {
    patterns.push({
      type: "recovery_success",
      description: `Recovered from ${metrics.recoveryCount} failure sequence(s)`,
      evidence: [`Total recoveries: ${metrics.recoveryCount}`],
      severity: "info",
    });
  }

  // Error cascade pattern
  if (metrics.errorRate > HIGH_ERROR_RATE_THRESHOLD) {
    patterns.push({
      type: "error_cascade",
      description: `High error rate: ${Math.round(metrics.errorRate * 100)}%`,
      evidence: [
        `${metrics.failedActions} of ${metrics.totalActions} actions failed`,
      ],
      severity: "warning",
    });
  }

  // Pivot effectiveness patterns
  for (const pivot of pivotAnalysis.effectivePivots) {
    patterns.push({
      type: "pivot_effective",
      description: `Strategy change from "${pivot.fromApproach}" to "${pivot.toApproach}" was effective`,
      evidence: [pivot.reason],
      severity: "info",
    });
  }

  for (const pivot of pivotAnalysis.ineffectivePivots) {
    patterns.push({
      type: "pivot_ineffective",
      description: `Strategy change to "${pivot.toApproach}" did not improve outcomes`,
      evidence: [pivot.reason],
      severity: "warning",
    });
  }

  // Tool usage patterns
  for (const [tool, stats] of metrics.toolUsage) {
    const total = stats.success + stats.failure;
    if (total >= 3) {
      const successRate = stats.success / total;

      if (successRate >= 0.8) {
        patterns.push({
          type: "tool_mastery",
          description: `Strong proficiency with ${tool}`,
          evidence: [`${stats.success}/${total} successful uses`],
          severity: "info",
        });
      } else if (successRate <= 0.3) {
        patterns.push({
          type: "tool_struggle",
          description: `Repeated issues with ${tool}`,
          evidence: [`${stats.failure}/${total} failed uses`],
          severity: "warning",
        });
      }
    }
  }

  // Duration patterns
  if (metrics.totalDuration < QUICK_RESOLUTION_THRESHOLD && episode.isSuccess()) {
    patterns.push({
      type: "quick_resolution",
      description: `Completed quickly (${Math.round(metrics.totalDuration / 1000)}s)`,
      evidence: ["Efficient execution path"],
      severity: "info",
    });
  } else if (metrics.totalDuration > PROLONGED_DURATION_THRESHOLD) {
    patterns.push({
      type: "prolonged_attempt",
      description: `Extended duration (${Math.round(metrics.totalDuration / 60000)} minutes)`,
      evidence: [
        `${metrics.totalActions} actions over ${Math.round(metrics.totalDuration / 60000)} minutes`,
      ],
      severity: episode.isFailed() ? "warning" : "info",
    });
  }

  // Decision quality analysis
  const decisions = episode.trajectory.decisions;
  if (decisions.length > 0) {
    const decisionPattern = analyzeDecisionQuality(episode, decisions);
    if (decisionPattern) {
      patterns.push(decisionPattern);
    }
  }

  return patterns;
}

function getConsecutiveFailureEvidence(episode: Episode): string[] {
  const actions = episode.getAllActions();
  const evidence: string[] = [];

  let consecutiveStart = -1;
  let consecutiveCount = 0;

  for (let i = 0; i < actions.length; i++) {
    if (!actions[i].success) {
      if (consecutiveStart === -1) {
        consecutiveStart = i;
      }
      consecutiveCount++;
    } else {
      if (consecutiveCount >= REPEATED_FAILURE_THRESHOLD) {
        const failedActions = actions.slice(consecutiveStart, consecutiveStart + consecutiveCount);
        evidence.push(
          `Actions ${consecutiveStart + 1}-${consecutiveStart + consecutiveCount}: ${failedActions
            .map((a) => a.action.slice(0, 50))
            .join(", ")}`
        );
      }
      consecutiveStart = -1;
      consecutiveCount = 0;
    }
  }

  // Check final sequence
  if (consecutiveCount >= REPEATED_FAILURE_THRESHOLD) {
    evidence.push(`Final ${consecutiveCount} actions were failures`);
  }

  return evidence;
}

function analyzeDecisionQuality(
  episode: Episode,
  decisions: Decision[]
): DetectedPattern | null {
  // Analyze if decisions led to good outcomes
  const actions = episode.getAllActions();

  let goodDecisions = 0;
  let poorDecisions = 0;

  for (const decision of decisions) {
    const decisionTime = decision.timestamp.getTime();
    // Get actions right after decision
    const actionsAfterDecision = actions.filter(
      (a) =>
        a.timestamp.getTime() > decisionTime &&
        a.timestamp.getTime() < decisionTime + 60000 // within 1 minute
    );

    if (actionsAfterDecision.length > 0) {
      const successRate =
        actionsAfterDecision.filter((a) => a.success).length /
        actionsAfterDecision.length;
      if (successRate > 0.6) {
        goodDecisions++;
      } else if (successRate < 0.4) {
        poorDecisions++;
      }
    }
  }

  if (goodDecisions > poorDecisions && goodDecisions >= 2) {
    return {
      type: "decision_quality",
      description: "Most strategic decisions led to successful outcomes",
      evidence: [`${goodDecisions} of ${decisions.length} decisions followed by success`],
      severity: "info",
    };
  } else if (poorDecisions > goodDecisions && poorDecisions >= 2) {
    return {
      type: "decision_quality",
      description: "Several strategic decisions led to poor outcomes",
      evidence: [`${poorDecisions} of ${decisions.length} decisions followed by failures`],
      severity: "warning",
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reflection Extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractWhatWorked(
  episode: Episode,
  metrics: TrajectoryMetrics,
  pivotAnalysis: PivotAnalysis,
  patterns: DetectedPattern[]
): string[] {
  const whatWorked: string[] = [];

  // Quick resolution
  if (patterns.some((p) => p.type === "quick_resolution")) {
    whatWorked.push("Efficient execution with minimal backtracking");
  }

  // Tool mastery
  const masteredTools = patterns.filter((p) => p.type === "tool_mastery");
  for (const pattern of masteredTools) {
    whatWorked.push(pattern.description);
  }

  // Effective pivots
  for (const pivot of pivotAnalysis.effectivePivots) {
    whatWorked.push(
      `Changing approach from "${pivot.fromApproach}" to "${pivot.toApproach}"`
    );
  }

  // Recovery success
  if (patterns.some((p) => p.type === "recovery_success")) {
    whatWorked.push("Successfully recovered from errors and continued");
  }

  // Good decision quality
  const goodDecisions = patterns.find(
    (p) => p.type === "decision_quality" && p.severity === "info"
  );
  if (goodDecisions) {
    whatWorked.push("Strategic decisions led to successful outcomes");
  }

  // If episode succeeded and had low error rate
  if (episode.isSuccess() && metrics.errorRate < 0.2) {
    whatWorked.push("Clean execution with minimal errors");
  }

  // If discovery-triggered pivots led to success
  if (pivotAnalysis.discoveryPivots > 0 && episode.isSuccess()) {
    whatWorked.push("Learning from discoveries during execution");
  }

  return whatWorked.slice(0, 5); // Limit to 5 items
}

function extractWhatFailed(
  episode: Episode,
  metrics: TrajectoryMetrics,
  patterns: DetectedPattern[]
): string[] {
  const whatFailed: string[] = [];

  // Repeated failures
  const repeatedFailures = patterns.find((p) => p.type === "repeated_failure");
  if (repeatedFailures) {
    whatFailed.push(repeatedFailures.description);
  }

  // Tool struggles
  const toolStruggles = patterns.filter((p) => p.type === "tool_struggle");
  for (const pattern of toolStruggles) {
    whatFailed.push(pattern.description);
  }

  // Ineffective pivots
  const ineffectivePivots = patterns.filter((p) => p.type === "pivot_ineffective");
  for (const pattern of ineffectivePivots) {
    whatFailed.push(pattern.description);
  }

  // Error cascade
  const errorCascade = patterns.find((p) => p.type === "error_cascade");
  if (errorCascade) {
    whatFailed.push("High error rate throughout execution");
  }

  // Poor decisions
  const poorDecisions = patterns.find(
    (p) => p.type === "decision_quality" && p.severity === "warning"
  );
  if (poorDecisions) {
    whatFailed.push("Strategic decisions that led to poor outcomes");
  }

  // Prolonged attempt that failed
  if (episode.isFailed() && patterns.some((p) => p.type === "prolonged_attempt")) {
    whatFailed.push("Extended effort without achieving goal");
  }

  return whatFailed.slice(0, 5); // Limit to 5 items
}

function extractKeyInsights(
  episode: Episode,
  metrics: TrajectoryMetrics,
  pivotAnalysis: PivotAnalysis,
  patterns: DetectedPattern[]
): string[] {
  const insights: string[] = [];

  // Insight from pivots
  if (pivotAnalysis.errorTriggeredPivots > 0) {
    insights.push(
      `Errors prompted ${pivotAnalysis.errorTriggeredPivots} strategy change(s) - consider detecting these patterns earlier`
    );
  }

  // Tool-specific insights
  for (const [tool, stats] of metrics.toolUsage) {
    const total = stats.success + stats.failure;
    if (total >= 5) {
      const successRate = stats.success / total;
      if (successRate < 0.5) {
        insights.push(
          `${tool} had ${Math.round(successRate * 100)}% success rate - may need different approach or parameters`
        );
      }
    }
  }

  // Duration insights
  if (metrics.totalDuration > PROLONGED_DURATION_THRESHOLD) {
    if (episode.isSuccess()) {
      insights.push(
        "Task completed but took longer than expected - look for optimization opportunities"
      );
    } else {
      insights.push(
        "Extended duration without success suggests fundamental approach issue"
      );
    }
  }

  // Recovery insights
  if (metrics.recoveryCount > 2) {
    insights.push(
      `Multiple recovery cycles (${metrics.recoveryCount}) - consider more defensive approach upfront`
    );
  }

  // Decision insights from patterns
  const decisionPattern = patterns.find((p) => p.type === "decision_quality");
  if (decisionPattern) {
    insights.push(decisionPattern.description);
  }

  // Effective pivot insights
  for (const pivot of pivotAnalysis.effectivePivots.slice(0, 2)) {
    insights.push(
      `"${pivot.toApproach}" was more effective than "${pivot.fromApproach}" for this type of task`
    );
  }

  return insights.slice(0, 5); // Limit to 5 items
}

function generateWouldDoDifferently(
  episode: Episode,
  metrics: TrajectoryMetrics,
  patterns: DetectedPattern[]
): string {
  const suggestions: string[] = [];

  // If high error rate, suggest different approach
  if (metrics.errorRate > HIGH_ERROR_RATE_THRESHOLD) {
    suggestions.push("Start with a simpler, incremental approach to catch errors early");
  }

  // If repeated failures with specific tools
  const toolStruggles = patterns.filter((p) => p.type === "tool_struggle");
  if (toolStruggles.length > 0) {
    const tools = toolStruggles.map((p) => p.description.split(" ")[3]); // Extract tool name
    suggestions.push(`Reconsider use of ${tools.join(", ")} or verify correct parameters`);
  }

  // If many error-triggered pivots
  const errorPivots = patterns.filter(
    (p) => p.type === "pivot_ineffective" || p.type === "pivot_effective"
  );
  if (errorPivots.length > 2) {
    suggestions.push("Plan strategy more thoroughly before starting execution");
  }

  // If prolonged attempt
  if (patterns.some((p) => p.type === "prolonged_attempt") && episode.isFailed()) {
    suggestions.push("Set a time limit and reassess approach if not making progress");
  }

  // If many consecutive failures
  if (metrics.maxConsecutiveFailures >= CONSECUTIVE_FAILURE_WARNING) {
    suggestions.push("Stop after 3 consecutive failures to reassess rather than continuing");
  }

  // If effective pivots found, reference them
  const effectivePivots = patterns.filter((p) => p.type === "pivot_effective");
  if (effectivePivots.length > 0 && !episode.isSuccess()) {
    suggestions.push(`Try the "${effectivePivots[0].description.split('"')[3]}" approach earlier`);
  }

  if (suggestions.length === 0) {
    if (episode.isSuccess()) {
      return "Approach was effective - could optimize for speed by reducing exploratory steps";
    } else {
      return "Consider breaking the task into smaller, verifiable sub-tasks";
    }
  }

  return suggestions.slice(0, 3).join(". ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Calculation
// ─────────────────────────────────────────────────────────────────────────────

function calculateConfidence(
  episode: Episode,
  metrics: TrajectoryMetrics,
  patterns: DetectedPattern[]
): number {
  let confidence = 0.5; // Base confidence

  // More actions = more evidence = higher confidence
  if (metrics.totalActions >= 10) {
    confidence += 0.1;
  } else if (metrics.totalActions >= 5) {
    confidence += 0.05;
  }

  // More patterns detected = more confident in analysis
  if (patterns.length >= 5) {
    confidence += 0.15;
  } else if (patterns.length >= 3) {
    confidence += 0.1;
  }

  // Decisions and pivots add context
  if (episode.trajectory.decisions.length > 0) {
    confidence += 0.1;
  }
  if (episode.trajectory.pivots.length > 0) {
    confidence += 0.05;
  }

  // Clear outcome (success or failure) vs partial
  if (episode.isSuccess() || episode.isFailed()) {
    confidence += 0.1;
  }

  // Cap at 0.95 (never 100% confident in automated analysis)
  return Math.min(confidence, 0.95);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mergeArrays(existing: string[], generated: string[]): string[] {
  const merged = new Set(existing);
  for (const item of generated) {
    // Only add if not a duplicate (case-insensitive)
    const isDuplicate = Array.from(merged).some(
      (e) => e.toLowerCase() === item.toLowerCase()
    );
    if (!isDuplicate) {
      merged.add(item);
    }
  }
  return Array.from(merged);
}

function generateCrossEpisodeRecommendations(
  successPatterns: string[],
  failurePatterns: string[]
): string[] {
  const recommendations: string[] = [];

  // Recommend more of what works
  for (const pattern of successPatterns.slice(0, 2)) {
    if (pattern.includes("tool_mastery")) {
      recommendations.push(`Continue using tools that show high success rates`);
    } else if (pattern.includes("pivot_effective")) {
      recommendations.push(`Be willing to change approach when initial strategy isn't working`);
    } else if (pattern.includes("quick_resolution")) {
      recommendations.push(`Build on efficient execution patterns from past successes`);
    }
  }

  // Recommend avoiding what fails
  for (const pattern of failurePatterns.slice(0, 2)) {
    if (pattern.includes("repeated_failure")) {
      recommendations.push(`Stop after 3 consecutive failures and reassess approach`);
    } else if (pattern.includes("tool_struggle")) {
      recommendations.push(`Verify tool parameters and consider alternatives for struggling tools`);
    } else if (pattern.includes("error_cascade")) {
      recommendations.push(`Take a defensive approach to catch errors early`);
    }
  }

  return recommendations;
}
