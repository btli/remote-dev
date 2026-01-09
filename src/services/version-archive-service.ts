/**
 * VersionArchiveService - Manages orchestrator version history.
 *
 * Part of the Self-Modification Engine architecture.
 * Provides:
 * - Version creation and storage
 * - Version comparison and selection
 * - A/B testing support
 * - Rollback capabilities
 *
 * The archive enables the orchestrator to track its evolution
 * and revert to known-good configurations when needed.
 */

import {
  OrchestratorVersion,
  DEFAULT_ORCHESTRATOR_CONFIG,
  type OrchestratorVersionProps,
  type OrchestratorConfig,
  type VersionMetrics,
} from "@/domain/entities/OrchestratorVersion";

export interface VersionComparisonResult {
  versionA: {
    id: string;
    version: number;
    score: number;
    metrics: VersionMetrics;
  };
  versionB: {
    id: string;
    version: number;
    score: number;
    metrics: VersionMetrics;
  };
  winner: "a" | "b" | "tie";
  confidence: number;
  comparison: {
    successRateDiff: number;
    durationDiff: number;
    efficiencyDiff: number;
  };
}

export interface ABTestConfig {
  treatmentVersionId: string;
  controlVersionId: string;
  trafficSplit: number; // 0-1, percentage for treatment
  minSampleSize: number;
  maxDurationDays: number;
  startedAt: Date;
}

export interface ABTestResult {
  testId: string;
  config: ABTestConfig;
  treatmentMetrics: VersionMetrics;
  controlMetrics: VersionMetrics;
  significanceLevel: number;
  recommendation: "promote" | "rollback" | "continue";
  reason: string;
}

/**
 * In-memory version archive (should be backed by DB in production).
 */
export class VersionArchiveService {
  private versions: Map<string, OrchestratorVersion> = new Map();
  private versionsByOrchestrator: Map<string, string[]> = new Map();
  private activeVersions: Map<string, string> = new Map(); // orchestratorId → versionId
  private abTests: Map<string, ABTestConfig> = new Map();

  /**
   * Initialize version archive for an orchestrator.
   */
  async initializeOrchestrator(orchestratorId: string): Promise<OrchestratorVersion> {
    // Check if already initialized
    const existing = this.versionsByOrchestrator.get(orchestratorId);
    if (existing && existing.length > 0) {
      const activeId = this.activeVersions.get(orchestratorId);
      if (activeId) {
        const active = this.versions.get(activeId);
        if (active) return active;
      }
    }

    // Create initial version
    const version = OrchestratorVersion.createInitial({
      orchestratorId,
      config: DEFAULT_ORCHESTRATOR_CONFIG,
    });

    await this.saveVersion(version);
    this.activeVersions.set(orchestratorId, version.id);

    return version;
  }

  /**
   * Save a version to the archive.
   */
  async saveVersion(version: OrchestratorVersion): Promise<void> {
    this.versions.set(version.id, version);

    // Update orchestrator index
    const orchestratorVersions = this.versionsByOrchestrator.get(version.orchestratorId) ?? [];
    if (!orchestratorVersions.includes(version.id)) {
      orchestratorVersions.push(version.id);
      this.versionsByOrchestrator.set(version.orchestratorId, orchestratorVersions);
    }
  }

  /**
   * Get version by ID.
   */
  async getVersion(versionId: string): Promise<OrchestratorVersion | null> {
    return this.versions.get(versionId) ?? null;
  }

  /**
   * Get active version for an orchestrator.
   */
  async getActiveVersion(orchestratorId: string): Promise<OrchestratorVersion | null> {
    const activeId = this.activeVersions.get(orchestratorId);
    if (!activeId) return null;
    return this.versions.get(activeId) ?? null;
  }

  /**
   * Get all versions for an orchestrator.
   */
  async getVersionHistory(orchestratorId: string): Promise<OrchestratorVersion[]> {
    const versionIds = this.versionsByOrchestrator.get(orchestratorId) ?? [];
    return versionIds
      .map((id) => this.versions.get(id))
      .filter((v): v is OrchestratorVersion => v !== undefined)
      .sort((a, b) => b.version - a.version);
  }

  /**
   * Create a new version from the current active version.
   */
  async createNewVersion(
    orchestratorId: string,
    changes: {
      config?: Partial<OrchestratorConfig>;
      prompts?: Record<string, string>;
      improvements: string[];
    }
  ): Promise<OrchestratorVersion> {
    const currentActive = await this.getActiveVersion(orchestratorId);
    if (!currentActive) {
      throw new Error(`No active version for orchestrator: ${orchestratorId}`);
    }

    const newVersion = OrchestratorVersion.createFromParent(currentActive, {
      config: changes.config,
      prompts: changes.prompts,
      improvements: changes.improvements,
    });

    await this.saveVersion(newVersion);
    return newVersion;
  }

  /**
   * Promote a testing version to active.
   */
  async promoteVersion(versionId: string): Promise<OrchestratorVersion> {
    const version = await this.getVersion(versionId);
    if (!version) {
      throw new Error(`Version not found: ${versionId}`);
    }

    if (!version.isTesting()) {
      throw new Error(`Can only promote testing versions, current status: ${version.status}`);
    }

    // Archive current active version
    const currentActive = await this.getActiveVersion(version.orchestratorId);
    if (currentActive) {
      const archived = currentActive.archive();
      await this.saveVersion(archived);
    }

    // Promote new version
    const promoted = version.promote();
    await this.saveVersion(promoted);
    this.activeVersions.set(version.orchestratorId, promoted.id);

    return promoted;
  }

  /**
   * Rollback to a previous version.
   */
  async rollbackToVersion(versionId: string): Promise<OrchestratorVersion> {
    const version = await this.getVersion(versionId);
    if (!version) {
      throw new Error(`Version not found: ${versionId}`);
    }

    // Archive current active version
    const currentActive = await this.getActiveVersion(version.orchestratorId);
    if (currentActive) {
      const archived = currentActive.markRollback();
      await this.saveVersion(archived);
    }

    // Reactivate target version
    const reactivated = version.promote();
    await this.saveVersion(reactivated);
    this.activeVersions.set(version.orchestratorId, reactivated.id);

    return reactivated;
  }

  /**
   * Compare two versions.
   */
  async compareVersions(
    versionAId: string,
    versionBId: string
  ): Promise<VersionComparisonResult> {
    const versionA = await this.getVersion(versionAId);
    const versionB = await this.getVersion(versionBId);

    if (!versionA || !versionB) {
      throw new Error("One or both versions not found");
    }

    const scoreA = versionA.getPerformanceScore();
    const scoreB = versionB.getPerformanceScore();
    const metricsA = versionA.metrics;
    const metricsB = versionB.metrics;

    // Determine winner
    let winner: "a" | "b" | "tie" = "tie";
    const scoreDiff = Math.abs(scoreA - scoreB);
    if (scoreDiff > 0.05) {
      winner = scoreA > scoreB ? "a" : "b";
    }

    // Calculate confidence based on sample sizes
    const minSample = Math.min(
      metricsA.totalTasksEvaluated,
      metricsB.totalTasksEvaluated
    );
    const confidence = Math.min(1, minSample / 20);

    return {
      versionA: {
        id: versionA.id,
        version: versionA.version,
        score: scoreA,
        metrics: metricsA,
      },
      versionB: {
        id: versionB.id,
        version: versionB.version,
        score: scoreB,
        metrics: metricsB,
      },
      winner,
      confidence,
      comparison: {
        successRateDiff: metricsA.taskSuccessRate - metricsB.taskSuccessRate,
        durationDiff: metricsA.avgTaskDuration - metricsB.avgTaskDuration,
        efficiencyDiff:
          (metricsB.avgTokensPerTask - metricsA.avgTokensPerTask) /
          Math.max(1, metricsB.avgTokensPerTask),
      },
    };
  }

  /**
   * Get the best performing version.
   */
  async getBestVersion(orchestratorId: string, minSampleSize = 5): Promise<OrchestratorVersion | null> {
    const versions = await this.getVersionHistory(orchestratorId);

    const eligibleVersions = versions.filter(
      (v) => v.hasMinimumData(minSampleSize) && !v.isTesting()
    );

    if (eligibleVersions.length === 0) {
      return null;
    }

    return eligibleVersions.reduce((best, current) =>
      current.getPerformanceScore() > best.getPerformanceScore() ? current : best
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // A/B Testing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Start an A/B test.
   */
  async startABTest(
    treatmentVersionId: string,
    controlVersionId: string,
    options: {
      trafficSplit?: number;
      minSampleSize?: number;
      maxDurationDays?: number;
    } = {}
  ): Promise<string> {
    const testId = crypto.randomUUID();
    const config: ABTestConfig = {
      treatmentVersionId,
      controlVersionId,
      trafficSplit: options.trafficSplit ?? 0.5,
      minSampleSize: options.minSampleSize ?? 10,
      maxDurationDays: options.maxDurationDays ?? 7,
      startedAt: new Date(),
    };

    this.abTests.set(testId, config);
    return testId;
  }

  /**
   * Get which version to use for a task (for A/B testing).
   */
  async getVersionForTask(
    orchestratorId: string,
    _taskId: string
  ): Promise<OrchestratorVersion> {
    // Check for active A/B test
    const activeTest = Array.from(this.abTests.entries()).find(([_, config]) => {
      const treatment = this.versions.get(config.treatmentVersionId);
      return treatment?.orchestratorId === orchestratorId;
    });

    if (activeTest) {
      const [_, config] = activeTest;
      // Random assignment based on traffic split
      const usesTreatment = Math.random() < config.trafficSplit;
      const versionId = usesTreatment
        ? config.treatmentVersionId
        : config.controlVersionId;
      const version = await this.getVersion(versionId);
      if (version) return version;
    }

    // Fall back to active version
    const active = await this.getActiveVersion(orchestratorId);
    if (!active) {
      return this.initializeOrchestrator(orchestratorId);
    }
    return active;
  }

  /**
   * Evaluate an A/B test.
   */
  async evaluateABTest(testId: string): Promise<ABTestResult> {
    const config = this.abTests.get(testId);
    if (!config) {
      throw new Error(`Test not found: ${testId}`);
    }

    const treatment = await this.getVersion(config.treatmentVersionId);
    const control = await this.getVersion(config.controlVersionId);

    if (!treatment || !control) {
      throw new Error("Test versions not found");
    }

    const treatmentMetrics = treatment.metrics;
    const controlMetrics = control.metrics;

    // Check if we have enough data
    const hasSufficientData =
      treatmentMetrics.totalTasksEvaluated >= config.minSampleSize &&
      controlMetrics.totalTasksEvaluated >= config.minSampleSize;

    // Check if test has run long enough
    const daysSinceStart =
      (Date.now() - config.startedAt.getTime()) / (1000 * 60 * 60 * 24);
    const hasRunLongEnough = daysSinceStart >= config.maxDurationDays;

    // Calculate significance
    const treatmentScore = treatment.getPerformanceScore();
    const controlScore = control.getPerformanceScore();
    const scoreDiff = treatmentScore - controlScore;

    // Simple significance test based on score difference and sample size
    const minSample = Math.min(
      treatmentMetrics.totalTasksEvaluated,
      controlMetrics.totalTasksEvaluated
    );
    const significanceLevel = Math.min(1, minSample / 20) * Math.min(1, Math.abs(scoreDiff) * 10);

    // Determine recommendation
    let recommendation: ABTestResult["recommendation"] = "continue";
    let reason = "Insufficient data to make a recommendation";

    if (hasSufficientData || hasRunLongEnough) {
      if (scoreDiff > 0.05) {
        recommendation = "promote";
        reason = `Treatment outperforms control by ${(scoreDiff * 100).toFixed(1)}%`;
      } else if (scoreDiff < -0.05) {
        recommendation = "rollback";
        reason = `Control outperforms treatment by ${(Math.abs(scoreDiff) * 100).toFixed(1)}%`;
      } else {
        recommendation = "continue";
        reason = "No significant difference detected";
      }
    }

    return {
      testId,
      config,
      treatmentMetrics,
      controlMetrics,
      significanceLevel,
      recommendation,
      reason,
    };
  }

  /**
   * End an A/B test.
   */
  async endABTest(testId: string): Promise<void> {
    this.abTests.delete(testId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Metrics Updates
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update version metrics after a task completes.
   */
  async updateVersionMetrics(
    versionId: string,
    taskResult: {
      success: boolean;
      partial: boolean;
      duration: number;
      tokens: number;
      turns: number;
      agentSelectionCorrect: boolean;
    }
  ): Promise<OrchestratorVersion> {
    const version = await this.getVersion(versionId);
    if (!version) {
      throw new Error(`Version not found: ${versionId}`);
    }

    const updated = version.updateMetrics(taskResult);
    await this.saveVersion(updated);
    return updated;
  }
}
