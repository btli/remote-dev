/**
 * SelfImprovementService - Enables orchestrator to improve itself over time.
 *
 * Part of the Self-Modification Engine architecture.
 * Orchestrates the self-improvement loop:
 * 1. Evaluate current orchestrator on recent tasks
 * 2. Select highest-performing version as reference
 * 3. Analyze failures and suboptimal decisions
 * 4. Generate improvements
 * 5. Create new version with changes
 * 6. A/B test new version
 * 7. Promote if better, rollback if worse
 *
 * Safety constraints:
 * - Cannot modify core safety rules
 * - Cannot disable oversight
 * - Cannot increase autonomy beyond user-set limit
 * - All modifications logged to audit trail
 */

import type { VersionArchiveService, ABTestResult } from "./version-archive-service";
import type { TranscriptEvaluation } from "./transcript-evaluator-service";
import type { Reflection, SuggestedAction } from "./reflection-generator-service";
import type {
  OrchestratorVersion,
  OrchestratorConfig,
} from "@/domain/entities/OrchestratorVersion";

export interface ImprovementAnalysis {
  orchestratorId: string;
  currentVersionId: string;
  analyzedAt: Date;

  // Performance summary
  recentPerformance: {
    successRate: number;
    avgDuration: number;
    taskCount: number;
  };

  // Identified issues
  issues: ImprovementIssue[];

  // Proposed changes
  proposedChanges: ProposedChange[];

  // Confidence in analysis
  confidence: number;
}

export interface ImprovementIssue {
  type: "low_success_rate" | "high_duration" | "poor_agent_selection" | "parsing_errors" | "stall_frequency";
  severity: "high" | "medium" | "low";
  description: string;
  evidence: string[];
}

export interface ProposedChange {
  type: "config" | "prompt" | "heuristic" | "tool";
  component: string;
  currentValue: unknown;
  proposedValue: unknown;
  rationale: string;
  expectedImpact: number; // 0-1, expected improvement
  confidence: number;
}

export interface ImprovementCycleResult {
  cycleId: string;
  orchestratorId: string;
  startedAt: Date;
  completedAt: Date;

  // Analysis
  analysis: ImprovementAnalysis;

  // Actions taken
  newVersionCreated: boolean;
  newVersionId?: string;
  abTestStarted: boolean;
  abTestId?: string;

  // Summary
  changesApplied: number;
  skippedChanges: number;
  reason: string;
}

/**
 * Service for orchestrator self-improvement.
 */
export class SelfImprovementService {
  constructor(
    private readonly versionArchive: VersionArchiveService
  ) {}

  /**
   * Run a self-improvement cycle.
   */
  async runImprovementCycle(
    orchestratorId: string,
    context: {
      recentEvaluations: TranscriptEvaluation[];
      recentReflections: Reflection[];
      projectPath?: string;
    }
  ): Promise<ImprovementCycleResult> {
    const cycleId = crypto.randomUUID();
    const startedAt = new Date();

    // Get current version
    const currentVersion = await this.versionArchive.getActiveVersion(orchestratorId);
    if (!currentVersion) {
      throw new Error(`No active version for orchestrator: ${orchestratorId}`);
    }

    // Analyze current performance
    const analysis = await this.analyzePerformance(
      orchestratorId,
      currentVersion,
      context.recentEvaluations,
      context.recentReflections
    );

    // Check if improvement is needed
    if (analysis.issues.length === 0) {
      return {
        cycleId,
        orchestratorId,
        startedAt,
        completedAt: new Date(),
        analysis,
        newVersionCreated: false,
        abTestStarted: false,
        changesApplied: 0,
        skippedChanges: 0,
        reason: "No significant issues identified",
      };
    }

    // Generate proposed changes
    const proposedChanges = this.generateChanges(
      currentVersion,
      analysis.issues,
      context.recentReflections
    );

    analysis.proposedChanges = proposedChanges;

    // Filter changes by confidence and safety
    const safeChanges = proposedChanges.filter(
      (c) => c.confidence >= 0.6 && this.isSafeChange(c)
    );

    if (safeChanges.length === 0) {
      return {
        cycleId,
        orchestratorId,
        startedAt,
        completedAt: new Date(),
        analysis,
        newVersionCreated: false,
        abTestStarted: false,
        changesApplied: 0,
        skippedChanges: proposedChanges.length,
        reason: "No safe changes with sufficient confidence",
      };
    }

    // Apply changes to create new version
    const configChanges = this.buildConfigChanges(safeChanges, currentVersion.config);
    const improvements = safeChanges.map((c) => c.rationale);

    const newVersion = await this.versionArchive.createNewVersion(orchestratorId, {
      config: configChanges,
      improvements,
    });

    // Start A/B test
    const abTestId = await this.versionArchive.startABTest(
      newVersion.id,
      currentVersion.id,
      {
        trafficSplit: 0.3, // 30% traffic to new version
        minSampleSize: 10,
        maxDurationDays: 3,
      }
    );

    return {
      cycleId,
      orchestratorId,
      startedAt,
      completedAt: new Date(),
      analysis,
      newVersionCreated: true,
      newVersionId: newVersion.id,
      abTestStarted: true,
      abTestId,
      changesApplied: safeChanges.length,
      skippedChanges: proposedChanges.length - safeChanges.length,
      reason: `Created version ${newVersion.version} with ${safeChanges.length} improvements`,
    };
  }

  /**
   * Analyze current performance and identify issues.
   */
  private async analyzePerformance(
    orchestratorId: string,
    currentVersion: OrchestratorVersion,
    evaluations: TranscriptEvaluation[],
    reflections: Reflection[]
  ): Promise<ImprovementAnalysis> {
    const issues: ImprovementIssue[] = [];
    const metrics = currentVersion.metrics;

    // Calculate recent performance from evaluations
    const successCount = evaluations.filter((e) => e.outcome === "success").length;
    const avgDuration = evaluations.reduce((sum, e) => sum + e.metrics.durationSeconds, 0) /
      Math.max(1, evaluations.length);
    const recentPerformance = {
      successRate: successCount / Math.max(1, evaluations.length),
      avgDuration,
      taskCount: evaluations.length,
    };

    // Issue: Low success rate
    if (recentPerformance.successRate < 0.7) {
      issues.push({
        type: "low_success_rate",
        severity: recentPerformance.successRate < 0.5 ? "high" : "medium",
        description: `Success rate is ${(recentPerformance.successRate * 100).toFixed(1)}%, below 70% threshold`,
        evidence: evaluations
          .filter((e) => e.outcome !== "success")
          .slice(0, 3)
          .map((e) => e.whatFailed.join("; ")),
      });
    }

    // Issue: High duration
    const expectedDuration = 600; // 10 minutes baseline
    if (avgDuration > expectedDuration * 1.5) {
      issues.push({
        type: "high_duration",
        severity: avgDuration > expectedDuration * 2 ? "high" : "medium",
        description: `Average task duration is ${Math.round(avgDuration / 60)} minutes, above 15 minute threshold`,
        evidence: evaluations
          .filter((e) => e.metrics.durationSeconds > expectedDuration)
          .slice(0, 3)
          .map((e) => `Session ${e.sessionId}: ${Math.round(e.metrics.durationSeconds / 60)}min`),
      });
    }

    // Issue: Poor agent selection (from metrics)
    if (metrics.agentSelectionAccuracy < 0.7 && metrics.totalTasksEvaluated >= 5) {
      issues.push({
        type: "poor_agent_selection",
        severity: "medium",
        description: `Agent selection accuracy is ${(metrics.agentSelectionAccuracy * 100).toFixed(1)}%`,
        evidence: ["Review task type to agent mappings"],
      });
    }

    // Issue: High error rate from evaluations
    const errorEvaluations = evaluations.filter((e) => e.errorsEncountered.length > 0);
    if (errorEvaluations.length > evaluations.length * 0.5) {
      issues.push({
        type: "parsing_errors",
        severity: "medium",
        description: `${errorEvaluations.length}/${evaluations.length} tasks had errors`,
        evidence: errorEvaluations
          .slice(0, 3)
          .flatMap((e) => e.errorsEncountered.map((err) => err.message).slice(0, 2)),
      });
    }

    // Aggregate issues from reflections
    const highPriorityReflections = reflections.filter((r) => r.priority === "high");
    if (highPriorityReflections.length > 0) {
      issues.push({
        type: "stall_frequency",
        severity: "medium",
        description: `${highPriorityReflections.length} high-priority issues from reflections`,
        evidence: highPriorityReflections
          .slice(0, 3)
          .flatMap((r) => r.reflections.slice(0, 2)),
      });
    }

    // Calculate confidence based on data availability
    const confidence = Math.min(1, evaluations.length / 20);

    return {
      orchestratorId,
      currentVersionId: currentVersion.id,
      analyzedAt: new Date(),
      recentPerformance,
      issues,
      proposedChanges: [], // Will be filled in next step
      confidence,
    };
  }

  /**
   * Generate proposed changes based on issues.
   */
  private generateChanges(
    currentVersion: OrchestratorVersion,
    issues: ImprovementIssue[],
    reflections: Reflection[]
  ): ProposedChange[] {
    const changes: ProposedChange[] = [];
    const config = currentVersion.config;

    for (const issue of issues) {
      switch (issue.type) {
        case "low_success_rate":
          // Consider increasing monitoring frequency
          if (config.monitoring.checkIntervalSeconds > 20) {
            changes.push({
              type: "config",
              component: "monitoring.checkIntervalSeconds",
              currentValue: config.monitoring.checkIntervalSeconds,
              proposedValue: Math.max(15, config.monitoring.checkIntervalSeconds - 10),
              rationale: "Reduce monitoring interval to catch issues earlier",
              expectedImpact: 0.1,
              confidence: 0.7,
            });
          }
          break;

        case "high_duration":
          // Consider reducing stall threshold
          if (config.monitoring.stallThresholdSeconds > 180) {
            changes.push({
              type: "config",
              component: "monitoring.stallThresholdSeconds",
              currentValue: config.monitoring.stallThresholdSeconds,
              proposedValue: Math.max(120, config.monitoring.stallThresholdSeconds - 60),
              rationale: "Reduce stall threshold to intervene earlier",
              expectedImpact: 0.15,
              confidence: 0.6,
            });
          }
          break;

        case "poor_agent_selection":
          // Increase performance weight in selection
          if (config.agentSelection.performanceWeight < 0.9) {
            changes.push({
              type: "config",
              component: "agentSelection.performanceWeight",
              currentValue: config.agentSelection.performanceWeight,
              proposedValue: Math.min(0.95, config.agentSelection.performanceWeight + 0.1),
              rationale: "Increase weight of performance history in agent selection",
              expectedImpact: 0.2,
              confidence: 0.65,
            });
          }
          break;

        case "parsing_errors":
          // Increase confidence threshold for task parsing
          if (config.taskParsingHeuristics.confidenceThreshold < 0.8) {
            changes.push({
              type: "config",
              component: "taskParsingHeuristics.confidenceThreshold",
              currentValue: config.taskParsingHeuristics.confidenceThreshold,
              proposedValue: Math.min(0.85, config.taskParsingHeuristics.confidenceThreshold + 0.1),
              rationale: "Increase parsing confidence threshold to reduce ambiguous tasks",
              expectedImpact: 0.1,
              confidence: 0.55,
            });
          }
          break;

        case "stall_frequency":
          // Increase max retries
          if (config.monitoring.maxRetries < 5) {
            changes.push({
              type: "config",
              component: "monitoring.maxRetries",
              currentValue: config.monitoring.maxRetries,
              proposedValue: config.monitoring.maxRetries + 1,
              rationale: "Increase max retries to handle transient issues",
              expectedImpact: 0.1,
              confidence: 0.6,
            });
          }
          break;
      }
    }

    // Extract changes from high-confidence reflection actions
    for (const reflection of reflections) {
      for (const action of reflection.suggestedActions) {
        if (action.confidence >= 0.7) {
          changes.push({
            type: "heuristic",
            component: action.type,
            currentValue: null,
            proposedValue: action.implementation,
            rationale: action.description,
            expectedImpact: action.confidence * 0.2,
            confidence: action.confidence,
          });
        }
      }
    }

    return changes;
  }

  /**
   * Check if a change is safe to apply.
   */
  private isSafeChange(change: ProposedChange): boolean {
    // Safety constraints
    const unsafeComponents = [
      "autonomy.autoApplyImprovements",
      "safety",
      "oversight",
    ];

    // Check if change affects unsafe components
    if (unsafeComponents.some((c) => change.component.includes(c))) {
      return false;
    }

    // Check if change would disable monitoring
    if (
      change.component === "monitoring.checkIntervalSeconds" &&
      (change.proposedValue as number) < 10
    ) {
      return false;
    }

    // Check if change would reduce stall threshold too much
    if (
      change.component === "monitoring.stallThresholdSeconds" &&
      (change.proposedValue as number) < 60
    ) {
      return false;
    }

    return true;
  }

  /**
   * Build config changes from proposed changes.
   */
  private buildConfigChanges(
    changes: ProposedChange[],
    currentConfig: OrchestratorConfig
  ): Partial<OrchestratorConfig> {
    const result: Partial<OrchestratorConfig> = {};

    for (const change of changes) {
      if (change.type !== "config") continue;

      const parts = change.component.split(".");
      if (parts.length !== 2) continue;

      const [section, key] = parts;

      // Build the nested structure
      switch (section) {
        case "monitoring":
          result.monitoring = {
            ...currentConfig.monitoring,
            ...result.monitoring,
            [key]: change.proposedValue,
          };
          break;
        case "agentSelection":
          result.agentSelection = {
            ...currentConfig.agentSelection,
            ...result.agentSelection,
            [key]: change.proposedValue,
          };
          break;
        case "taskParsingHeuristics":
          result.taskParsingHeuristics = {
            ...currentConfig.taskParsingHeuristics,
            ...result.taskParsingHeuristics,
            [key]: change.proposedValue,
          };
          break;
        case "autonomy":
          result.autonomy = {
            ...currentConfig.autonomy,
            ...result.autonomy,
            [key]: change.proposedValue,
          };
          break;
      }
    }

    return result;
  }

  /**
   * Check A/B test results and take action.
   */
  async evaluateAndActOnTest(testId: string): Promise<{
    action: "promoted" | "rolled_back" | "continued";
    reason: string;
  }> {
    const result = await this.versionArchive.evaluateABTest(testId);

    switch (result.recommendation) {
      case "promote":
        await this.versionArchive.promoteVersion(result.config.treatmentVersionId);
        await this.versionArchive.endABTest(testId);
        return {
          action: "promoted",
          reason: result.reason,
        };

      case "rollback":
        await this.versionArchive.endABTest(testId);
        return {
          action: "rolled_back",
          reason: result.reason,
        };

      case "continue":
      default:
        return {
          action: "continued",
          reason: result.reason,
        };
    }
  }

  /**
   * Get improvement history for an orchestrator.
   */
  async getImprovementHistory(orchestratorId: string): Promise<{
    versions: Array<{
      id: string;
      version: number;
      status: string;
      improvements: string[];
      metrics: unknown;
      createdAt: Date;
    }>;
    totalVersions: number;
    activeVersion: number;
  }> {
    const versions = await this.versionArchive.getVersionHistory(orchestratorId);
    const active = await this.versionArchive.getActiveVersion(orchestratorId);

    return {
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        improvements: v.improvements,
        metrics: v.metrics,
        createdAt: v.createdAt,
      })),
      totalVersions: versions.length,
      activeVersion: active?.version ?? 0,
    };
  }
}
