/**
 * Episode Entity - Represents a specific task experience (episodic memory)
 *
 * Episodes are specific instances of task execution that can be used
 * for contextual learning and retrieval of relevant past experiences.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type EpisodeType =
  | "task_execution"
  | "error_recovery"
  | "tool_discovery"
  | "agent_interaction"
  | "user_feedback";

export type EpisodeOutcome = "success" | "failure" | "partial" | "cancelled";

export interface TrajectoryStep {
  timestamp: Date;
  action: string;
  tool?: string;
  input?: string;
  output?: string;
  duration: number; // ms
  success: boolean;
}

export interface Decision {
  timestamp: Date;
  context: string;
  options: string[];
  chosen: string;
  reasoning: string;
}

export interface Pivot {
  timestamp: Date;
  fromApproach: string;
  toApproach: string;
  reason: string;
  triggered_by: "error" | "feedback" | "discovery" | "timeout";
}

export interface EpisodeContext {
  taskDescription: string;
  projectPath: string;
  initialState: string; // Summary of starting point
  agentProvider?: string;
  sessionId?: string;
}

export interface EpisodeTrajectory {
  actions: TrajectoryStep[];
  observations: string[];
  decisions: Decision[];
  pivots: Pivot[];
}

export interface EpisodeOutcomeData {
  outcome: EpisodeOutcome;
  result: string;
  duration: number; // ms
  cost?: number;
  errorCount: number;
  toolCallCount: number;
}

export interface EpisodeReflection {
  whatWorked: string[];
  whatFailed: string[];
  keyInsights: string[];
  wouldDoDifferently?: string;
  userRating?: number; // 1-5
  userFeedback?: string;
}

export interface EpisodeProps {
  id: string;
  taskId: string;
  folderId: string;
  type: EpisodeType;
  context: EpisodeContext;
  trajectory: EpisodeTrajectory;
  outcome: EpisodeOutcomeData;
  reflection: EpisodeReflection;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Episode Entity (Immutable)
// ─────────────────────────────────────────────────────────────────────────────

export class Episode {
  readonly id: string;
  readonly taskId: string;
  readonly folderId: string;
  readonly type: EpisodeType;
  readonly context: EpisodeContext;
  readonly trajectory: EpisodeTrajectory;
  readonly outcome: EpisodeOutcomeData;
  readonly reflection: EpisodeReflection;
  readonly tags: string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: EpisodeProps) {
    this.id = props.id;
    this.taskId = props.taskId;
    this.folderId = props.folderId;
    this.type = props.type;
    this.context = { ...props.context };
    this.trajectory = {
      actions: [...props.trajectory.actions],
      observations: [...props.trajectory.observations],
      decisions: [...props.trajectory.decisions],
      pivots: [...props.trajectory.pivots],
    };
    this.outcome = { ...props.outcome };
    this.reflection = { ...props.reflection };
    this.tags = [...props.tags];
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /**
   * Create a new Episode.
   */
  static create(props: Omit<EpisodeProps, "id" | "createdAt" | "updatedAt">): Episode {
    return new Episode({
      ...props,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Reconstitute from stored data.
   */
  static fromProps(props: EpisodeProps): Episode {
    return new Episode(props);
  }

  /**
   * Add reflection to the episode.
   */
  withReflection(reflection: EpisodeReflection): Episode {
    return new Episode({
      ...this.toProps(),
      reflection,
      updatedAt: new Date(),
    });
  }

  /**
   * Add user feedback.
   */
  withUserFeedback(rating: number, feedback?: string): Episode {
    return new Episode({
      ...this.toProps(),
      reflection: {
        ...this.reflection,
        userRating: rating,
        userFeedback: feedback,
      },
      updatedAt: new Date(),
    });
  }

  /**
   * Add tags.
   */
  withTags(tags: string[]): Episode {
    const uniqueTags = [...new Set([...this.tags, ...tags])];
    return new Episode({
      ...this.toProps(),
      tags: uniqueTags,
      updatedAt: new Date(),
    });
  }

  /**
   * Check if episode was successful.
   */
  isSuccess(): boolean {
    return this.outcome.outcome === "success";
  }

  /**
   * Check if episode failed.
   */
  isFailed(): boolean {
    return this.outcome.outcome === "failure";
  }

  /**
   * Get episode summary for context injection.
   */
  getSummary(): string {
    const outcomeEmoji = this.isSuccess() ? "✅" : this.isFailed() ? "❌" : "⚠️";
    const duration = Math.round(this.outcome.duration / 1000);

    return `${outcomeEmoji} ${this.type}: ${this.context.taskDescription.slice(0, 100)}... (${duration}s, ${this.outcome.toolCallCount} tools)`;
  }

  /**
   * Get learnings summary for context injection.
   */
  getLearningsSummary(): string {
    const parts: string[] = [];

    if (this.reflection.whatWorked.length > 0) {
      parts.push(`What worked: ${this.reflection.whatWorked.join("; ")}`);
    }

    if (this.reflection.whatFailed.length > 0) {
      parts.push(`What failed: ${this.reflection.whatFailed.join("; ")}`);
    }

    if (this.reflection.keyInsights.length > 0) {
      parts.push(`Key insights: ${this.reflection.keyInsights.join("; ")}`);
    }

    if (this.reflection.wouldDoDifferently) {
      parts.push(`Would do differently: ${this.reflection.wouldDoDifferently}`);
    }

    return parts.join("\n");
  }

  /**
   * Get context for similar task injection.
   */
  getContextForSimilarTask(): string {
    const lines: string[] = [];

    lines.push(`## Previous Similar Task Experience`);
    lines.push(`Task: ${this.context.taskDescription}`);
    lines.push(`Outcome: ${this.outcome.outcome} (${Math.round(this.outcome.duration / 1000)}s)`);

    if (this.isSuccess()) {
      if (this.reflection.whatWorked.length > 0) {
        lines.push(`\n### What Worked`);
        for (const item of this.reflection.whatWorked) {
          lines.push(`- ${item}`);
        }
      }

      if (this.reflection.keyInsights.length > 0) {
        lines.push(`\n### Key Insights`);
        for (const item of this.reflection.keyInsights) {
          lines.push(`- ${item}`);
        }
      }
    } else {
      if (this.reflection.whatFailed.length > 0) {
        lines.push(`\n### What Failed (Avoid These)`);
        for (const item of this.reflection.whatFailed) {
          lines.push(`- ⚠️ ${item}`);
        }
      }

      if (this.reflection.wouldDoDifferently) {
        lines.push(`\n### Recommended Approach`);
        lines.push(this.reflection.wouldDoDifferently);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get key decisions made during the episode.
   */
  getKeyDecisions(): string[] {
    return this.trajectory.decisions.map(
      (d) => `${d.chosen}: ${d.reasoning}`
    );
  }

  /**
   * Get pivots/approach changes.
   */
  getPivots(): string[] {
    return this.trajectory.pivots.map(
      (p) => `Changed from "${p.fromApproach}" to "${p.toApproach}" because: ${p.reason}`
    );
  }

  /**
   * Calculate episode quality score for ranking.
   */
  getQualityScore(): number {
    let score = 0;

    // Base score from outcome
    if (this.isSuccess()) {
      score += 50;
    } else if (this.outcome.outcome === "partial") {
      score += 25;
    }

    // User rating (if present)
    if (this.reflection.userRating) {
      score += (this.reflection.userRating / 5) * 30;
    }

    // Reflection completeness
    const reflectionItems =
      this.reflection.whatWorked.length +
      this.reflection.whatFailed.length +
      this.reflection.keyInsights.length;
    score += Math.min(reflectionItems * 2, 20);

    return Math.min(score, 100);
  }

  /**
   * Convert to plain object for persistence.
   */
  toProps(): EpisodeProps {
    return {
      id: this.id,
      taskId: this.taskId,
      folderId: this.folderId,
      type: this.type,
      context: { ...this.context },
      trajectory: {
        actions: [...this.trajectory.actions],
        observations: [...this.trajectory.observations],
        decisions: [...this.trajectory.decisions],
        pivots: [...this.trajectory.pivots],
      },
      outcome: { ...this.outcome },
      reflection: { ...this.reflection },
      tags: [...this.tags],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Episode Builder (for incremental construction during task execution)
// ─────────────────────────────────────────────────────────────────────────────

export class EpisodeBuilder {
  private taskId: string;
  private folderId: string;
  private type: EpisodeType;
  private context: Partial<EpisodeContext> = {};
  private actions: TrajectoryStep[] = [];
  private observations: string[] = [];
  private decisions: Decision[] = [];
  private pivots: Pivot[] = [];
  private startTime: Date;
  private errorCount = 0;
  private toolCallCount = 0;

  constructor(taskId: string, folderId: string, type: EpisodeType = "task_execution") {
    this.taskId = taskId;
    this.folderId = folderId;
    this.type = type;
    this.startTime = new Date();
  }

  setContext(context: Partial<EpisodeContext>): this {
    this.context = { ...this.context, ...context };
    return this;
  }

  addAction(action: Omit<TrajectoryStep, "timestamp">): this {
    this.actions.push({
      ...action,
      timestamp: new Date(),
    });
    this.toolCallCount++;
    if (!action.success) {
      this.errorCount++;
    }
    return this;
  }

  addObservation(observation: string): this {
    this.observations.push(observation);
    return this;
  }

  addDecision(decision: Omit<Decision, "timestamp">): this {
    this.decisions.push({
      ...decision,
      timestamp: new Date(),
    });
    return this;
  }

  addPivot(pivot: Omit<Pivot, "timestamp">): this {
    this.pivots.push({
      ...pivot,
      timestamp: new Date(),
    });
    return this;
  }

  build(
    outcome: EpisodeOutcome,
    result: string,
    reflection: EpisodeReflection,
    tags: string[] = []
  ): Episode {
    const duration = Date.now() - this.startTime.getTime();

    return Episode.create({
      taskId: this.taskId,
      folderId: this.folderId,
      type: this.type,
      context: {
        taskDescription: this.context.taskDescription || "",
        projectPath: this.context.projectPath || "",
        initialState: this.context.initialState || "",
        agentProvider: this.context.agentProvider,
        sessionId: this.context.sessionId,
      },
      trajectory: {
        actions: this.actions,
        observations: this.observations,
        decisions: this.decisions,
        pivots: this.pivots,
      },
      outcome: {
        outcome,
        result,
        duration,
        errorCount: this.errorCount,
        toolCallCount: this.toolCallCount,
      },
      reflection,
      tags,
    });
  }
}
