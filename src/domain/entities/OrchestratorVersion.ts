/**
 * OrchestratorVersion - Domain entity representing a version of orchestrator configuration.
 *
 * Part of the Self-Modification Engine architecture.
 * Tracks every orchestrator 'version' with:
 * - Configuration snapshots
 * - Performance metrics
 * - Version lineage (parent → child)
 * - Applied improvements
 *
 * Inspired by:
 * - Gödel Agent: Self-referential modification
 * - Self-Improving Coding Agent: Meta-agent version selection
 *
 * This entity is immutable - state changes return a new instance.
 */

import { InvalidValueError } from "../errors/DomainError";

export interface OrchestratorVersionProps {
  id: string;
  orchestratorId: string;
  version: number;
  config: OrchestratorConfig;
  prompts: Record<string, string>;
  tools: VersionToolDefinition[];
  metrics: VersionMetrics;
  parentVersionId: string | null;
  improvements: string[];
  status: "active" | "testing" | "archived" | "rollback";
  createdAt: Date;
  updatedAt: Date;
}

export interface OrchestratorConfig {
  // Task parsing configuration
  taskParsingHeuristics: {
    keywordWeights: Record<string, number>;
    confidenceThreshold: number;
  };

  // Agent selection configuration
  agentSelection: {
    defaultAgent: string;
    taskTypePreferences: Record<string, string>;
    performanceWeight: number; // 0-1, how much to weight past performance
  };

  // Monitoring configuration
  monitoring: {
    stallThresholdSeconds: number;
    checkIntervalSeconds: number;
    maxRetries: number;
  };

  // Autonomy configuration
  autonomy: {
    autoApplyImprovements: boolean;
    confidenceThreshold: number;
    maxChangesPerCycle: number;
  };
}

export interface VersionToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  usageCount: number;
  successRate: number;
}

export interface VersionMetrics {
  // Task metrics
  taskSuccessRate: number;
  taskPartialRate: number;
  taskFailureRate: number;
  avgTaskDuration: number; // seconds

  // Efficiency metrics
  avgTokensPerTask: number;
  avgTurnsPerTask: number;

  // Agent selection metrics
  agentSelectionAccuracy: number;
  agentSwitchRate: number; // How often initial selection was wrong

  // User satisfaction (if tracked)
  userSatisfactionScore: number | null;

  // Sample size
  totalTasksEvaluated: number;
  evaluationWindowDays: number;
}

export interface CreateOrchestratorVersionProps {
  id?: string;
  orchestratorId: string;
  version?: number;
  config: OrchestratorConfig;
  prompts?: Record<string, string>;
  tools?: VersionToolDefinition[];
  parentVersionId?: string;
  improvements?: string[];
}

/**
 * Default orchestrator configuration.
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  taskParsingHeuristics: {
    keywordWeights: {
      fix: 1.5,
      bug: 1.5,
      feature: 1.0,
      refactor: 1.2,
      test: 1.0,
      doc: 0.8,
    },
    confidenceThreshold: 0.6,
  },
  agentSelection: {
    defaultAgent: "claude",
    taskTypePreferences: {
      feature: "claude",
      bug: "claude",
      refactor: "claude",
      test: "codex",
    },
    performanceWeight: 0.7,
  },
  monitoring: {
    stallThresholdSeconds: 300,
    checkIntervalSeconds: 30,
    maxRetries: 3,
  },
  autonomy: {
    autoApplyImprovements: false,
    confidenceThreshold: 0.7,
    maxChangesPerCycle: 3,
  },
};

/**
 * Default prompts for orchestrator operations.
 */
export const DEFAULT_PROMPTS: Record<string, string> = {
  taskParsing: `Analyze the user's request and extract:
1. A clear task description
2. Task type (feature, bug, refactor, test, documentation, research, review, maintenance)
3. Confidence score (0-1)
4. Recommended agents in priority order`,

  contextInjection: `You are being assigned a task by the orchestrator.
Task: {task_description}
Type: {task_type}

Follow project conventions and complete the task efficiently.`,

  progressAnalysis: `Analyze the terminal output and determine:
1. Current status (working, blocked, completed, failed, idle)
2. Progress percentage (0-100)
3. What the agent is doing
4. Any blockers or issues`,
};

export class OrchestratorVersion {
  private constructor(private readonly props: OrchestratorVersionProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError(
        "OrchestratorVersion.id",
        this.props.id,
        "Must be a non-empty string"
      );
    }
    if (!this.props.orchestratorId || typeof this.props.orchestratorId !== "string") {
      throw new InvalidValueError(
        "OrchestratorVersion.orchestratorId",
        this.props.orchestratorId,
        "Must be a non-empty string"
      );
    }
    if (typeof this.props.version !== "number" || this.props.version < 1) {
      throw new InvalidValueError(
        "OrchestratorVersion.version",
        this.props.version,
        "Must be a positive integer"
      );
    }
  }

  /**
   * Create the first version for an orchestrator.
   */
  static createInitial(props: CreateOrchestratorVersionProps): OrchestratorVersion {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    return new OrchestratorVersion({
      id,
      orchestratorId: props.orchestratorId,
      version: 1,
      config: props.config,
      prompts: props.prompts ?? DEFAULT_PROMPTS,
      tools: props.tools ?? [],
      metrics: {
        taskSuccessRate: 0,
        taskPartialRate: 0,
        taskFailureRate: 0,
        avgTaskDuration: 0,
        avgTokensPerTask: 0,
        avgTurnsPerTask: 0,
        agentSelectionAccuracy: 0,
        agentSwitchRate: 0,
        userSatisfactionScore: null,
        totalTasksEvaluated: 0,
        evaluationWindowDays: 7,
      },
      parentVersionId: null,
      improvements: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Create a new version from a parent.
   */
  static createFromParent(
    parent: OrchestratorVersion,
    props: {
      id?: string;
      config?: Partial<OrchestratorConfig>;
      prompts?: Record<string, string>;
      tools?: VersionToolDefinition[];
      improvements: string[];
    }
  ): OrchestratorVersion {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    // Merge config with parent
    const config: OrchestratorConfig = {
      taskParsingHeuristics: {
        ...parent.props.config.taskParsingHeuristics,
        ...props.config?.taskParsingHeuristics,
      },
      agentSelection: {
        ...parent.props.config.agentSelection,
        ...props.config?.agentSelection,
      },
      monitoring: {
        ...parent.props.config.monitoring,
        ...props.config?.monitoring,
      },
      autonomy: {
        ...parent.props.config.autonomy,
        ...props.config?.autonomy,
      },
    };

    return new OrchestratorVersion({
      id,
      orchestratorId: parent.props.orchestratorId,
      version: parent.props.version + 1,
      config,
      prompts: props.prompts ?? parent.props.prompts,
      tools: props.tools ?? parent.props.tools,
      metrics: {
        // Start with zeroed metrics for new version
        taskSuccessRate: 0,
        taskPartialRate: 0,
        taskFailureRate: 0,
        avgTaskDuration: 0,
        avgTokensPerTask: 0,
        avgTurnsPerTask: 0,
        agentSelectionAccuracy: 0,
        agentSwitchRate: 0,
        userSatisfactionScore: null,
        totalTasksEvaluated: 0,
        evaluationWindowDays: 7,
      },
      parentVersionId: parent.props.id,
      improvements: props.improvements,
      status: "testing", // New versions start in testing
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Reconstitute from persisted data.
   */
  static reconstitute(props: OrchestratorVersionProps): OrchestratorVersion {
    return new OrchestratorVersion(props);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }

  get orchestratorId(): string {
    return this.props.orchestratorId;
  }

  get version(): number {
    return this.props.version;
  }

  get config(): OrchestratorConfig {
    return { ...this.props.config };
  }

  get prompts(): Record<string, string> {
    return { ...this.props.prompts };
  }

  get tools(): VersionToolDefinition[] {
    return [...this.props.tools];
  }

  get metrics(): VersionMetrics {
    return { ...this.props.metrics };
  }

  get parentVersionId(): string | null {
    return this.props.parentVersionId;
  }

  get improvements(): string[] {
    return [...this.props.improvements];
  }

  get status(): OrchestratorVersionProps["status"] {
    return this.props.status;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Status Transitions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Promote from testing to active.
   */
  promote(): OrchestratorVersion {
    if (this.props.status !== "testing") {
      throw new Error(`Cannot promote version with status: ${this.props.status}`);
    }
    return this.withUpdates({ status: "active" });
  }

  /**
   * Archive the version.
   */
  archive(): OrchestratorVersion {
    if (this.props.status === "archived") {
      return this;
    }
    return this.withUpdates({ status: "archived" });
  }

  /**
   * Mark as rollback (when reverting to a previous version).
   */
  markRollback(): OrchestratorVersion {
    return this.withUpdates({ status: "rollback" });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Metric Updates
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update metrics from task results.
   */
  updateMetrics(taskResult: {
    success: boolean;
    partial: boolean;
    duration: number;
    tokens: number;
    turns: number;
    agentSelectionCorrect: boolean;
  }): OrchestratorVersion {
    const currentMetrics = this.props.metrics;
    const n = currentMetrics.totalTasksEvaluated;

    // Incremental average update
    const newSuccessRate = (currentMetrics.taskSuccessRate * n + (taskResult.success ? 1 : 0)) / (n + 1);
    const newPartialRate = (currentMetrics.taskPartialRate * n + (taskResult.partial ? 1 : 0)) / (n + 1);
    const newFailureRate = (currentMetrics.taskFailureRate * n + (!taskResult.success && !taskResult.partial ? 1 : 0)) / (n + 1);
    const newAvgDuration = (currentMetrics.avgTaskDuration * n + taskResult.duration) / (n + 1);
    const newAvgTokens = (currentMetrics.avgTokensPerTask * n + taskResult.tokens) / (n + 1);
    const newAvgTurns = (currentMetrics.avgTurnsPerTask * n + taskResult.turns) / (n + 1);
    const newAgentAccuracy = (currentMetrics.agentSelectionAccuracy * n + (taskResult.agentSelectionCorrect ? 1 : 0)) / (n + 1);

    return this.withUpdates({
      metrics: {
        ...currentMetrics,
        taskSuccessRate: newSuccessRate,
        taskPartialRate: newPartialRate,
        taskFailureRate: newFailureRate,
        avgTaskDuration: newAvgDuration,
        avgTokensPerTask: newAvgTokens,
        avgTurnsPerTask: newAvgTurns,
        agentSelectionAccuracy: newAgentAccuracy,
        totalTasksEvaluated: n + 1,
      },
    });
  }

  /**
   * Update user satisfaction score.
   */
  updateSatisfaction(score: number): OrchestratorVersion {
    if (score < 0 || score > 1) {
      throw new InvalidValueError(
        "satisfactionScore",
        score,
        "Must be between 0 and 1"
      );
    }

    const currentScore = this.props.metrics.userSatisfactionScore;
    const n = this.props.metrics.totalTasksEvaluated;

    const newScore = currentScore === null
      ? score
      : (currentScore * (n - 1) + score) / n;

    return this.withUpdates({
      metrics: {
        ...this.props.metrics,
        userSatisfactionScore: newScore,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Comparison Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Calculate overall performance score.
   */
  getPerformanceScore(): number {
    const m = this.props.metrics;

    // Weighted combination of metrics
    const score =
      m.taskSuccessRate * 0.4 +
      m.taskPartialRate * 0.1 +
      (1 - m.taskFailureRate) * 0.2 +
      m.agentSelectionAccuracy * 0.2 +
      (m.userSatisfactionScore ?? 0.5) * 0.1;

    return score;
  }

  /**
   * Check if this version outperforms another.
   */
  outperforms(other: OrchestratorVersion, minSampleSize = 5): boolean {
    // Require minimum sample size for comparison
    if (
      this.props.metrics.totalTasksEvaluated < minSampleSize ||
      other.props.metrics.totalTasksEvaluated < minSampleSize
    ) {
      return false;
    }

    return this.getPerformanceScore() > other.getPerformanceScore();
  }

  /**
   * Check if metrics have enough data.
   */
  hasMinimumData(minTasks = 5): boolean {
    return this.props.metrics.totalTasksEvaluated >= minTasks;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if this is the initial version.
   */
  isInitial(): boolean {
    return this.props.parentVersionId === null;
  }

  /**
   * Check if this version is active.
   */
  isActive(): boolean {
    return this.props.status === "active";
  }

  /**
   * Check if this version is being tested.
   */
  isTesting(): boolean {
    return this.props.status === "testing";
  }

  /**
   * Get a specific prompt.
   */
  getPrompt(key: string): string | undefined {
    return this.props.prompts[key];
  }

  /**
   * Get a specific tool.
   */
  getTool(name: string): VersionToolDefinition | undefined {
    return this.props.tools.find((t) => t.name === name);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private withUpdates(updates: Partial<OrchestratorVersionProps>): OrchestratorVersion {
    return new OrchestratorVersion({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }

  /**
   * Convert to plain object for serialization.
   */
  toPlainObject(): OrchestratorVersionProps {
    return { ...this.props };
  }
}
