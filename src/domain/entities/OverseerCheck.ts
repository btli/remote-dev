/**
 * OverseerCheck - Domain entity for oversight monitoring results.
 *
 * Represents a single check of a delegation by the asynchronous oversight system.
 * Tracks observations, assessment, and any intervention decisions.
 *
 * Intervention Levels:
 * - none: Healthy, continue normally
 * - warn: Log warning, inject reminder into agent context
 * - redirect: Inject corrective prompt, suggest alternative approach
 * - pause: Pause delegation, await human decision
 * - terminate: Kill session, mark task failed
 */

import { randomUUID } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type OverseerStatus = "healthy" | "warning" | "critical";

export type InterventionType =
  | "none"
  | "warn"
  | "redirect"
  | "pause"
  | "terminate";

export type OverseerIssueType =
  | "infinite_loop"
  | "cost_runaway"
  | "time_runaway"
  | "error_spiral"
  | "task_deviation"
  | "safety_violation"
  | "stall_detected";

export interface OverseerIssue {
  type: OverseerIssueType;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  evidence: string[];
  confidence: number;
}

export interface OverseerObservations {
  scrollbackHash: string;
  scrollbackLength: number;
  lastActionTime: Date;
  repeatPatternDetected: boolean;
  errorCount: number;
  costAccumulated: number;
  timeElapsed: number;
  commandHistory: string[];
  filesModified: string[];
}

export interface OverseerAssessment {
  status: OverseerStatus;
  issues: OverseerIssue[];
  confidence: number;
}

export interface OverseerIntervention {
  type: InterventionType;
  reason: string;
  action: string;
  executed: boolean;
  executedAt: Date | null;
}

export interface OverseerCheckProps {
  id: string;
  delegationId: string;
  timestamp: Date;
  observations: OverseerObservations;
  assessment: OverseerAssessment;
  intervention: OverseerIntervention | null;
  createdAt: Date;
}

export interface CreateOverseerCheckProps {
  delegationId: string;
  observations: OverseerObservations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity
// ─────────────────────────────────────────────────────────────────────────────

export class OverseerCheck {
  private constructor(private readonly props: OverseerCheckProps) {
    Object.freeze(this.props);
    Object.freeze(this);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Factory Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Create a new overseer check from observations.
   */
  static create(props: CreateOverseerCheckProps): OverseerCheck {
    const now = new Date();
    return new OverseerCheck({
      id: randomUUID(),
      delegationId: props.delegationId,
      timestamp: now,
      observations: props.observations,
      // Initial assessment is healthy with no issues
      assessment: {
        status: "healthy",
        issues: [],
        confidence: 1.0,
      },
      intervention: null,
      createdAt: now,
    });
  }

  /**
   * Reconstitute from persistence.
   */
  static fromProps(props: OverseerCheckProps): OverseerCheck {
    return new OverseerCheck(props);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Getters
  // ───────────────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }

  get delegationId(): string {
    return this.props.delegationId;
  }

  get timestamp(): Date {
    return this.props.timestamp;
  }

  get observations(): OverseerObservations {
    return this.props.observations;
  }

  get assessment(): OverseerAssessment {
    return this.props.assessment;
  }

  get intervention(): OverseerIntervention | null {
    return this.props.intervention;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Check if this check detected any issues.
   */
  hasIssues(): boolean {
    return this.props.assessment.issues.length > 0;
  }

  /**
   * Check if this check requires intervention.
   */
  requiresIntervention(): boolean {
    return (
      this.props.intervention !== null &&
      this.props.intervention.type !== "none"
    );
  }

  /**
   * Check if intervention was executed.
   */
  interventionExecuted(): boolean {
    return this.props.intervention?.executed ?? false;
  }

  /**
   * Get the highest severity issue.
   */
  getHighestSeverityIssue(): OverseerIssue | null {
    if (this.props.assessment.issues.length === 0) return null;

    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...this.props.assessment.issues].sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    )[0];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // State Transitions
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Set the assessment based on analysis.
   */
  withAssessment(assessment: OverseerAssessment): OverseerCheck {
    return new OverseerCheck({
      ...this.props,
      assessment,
    });
  }

  /**
   * Add an issue to the assessment.
   */
  addIssue(issue: OverseerIssue): OverseerCheck {
    const newIssues = [...this.props.assessment.issues, issue];

    // Determine status based on highest severity
    let status: OverseerStatus = "healthy";
    for (const i of newIssues) {
      if (i.severity === "critical" || i.severity === "high") {
        status = "critical";
        break;
      } else if (i.severity === "medium") {
        status = "warning";
      } else if (status !== "warning" && i.severity === "low") {
        status = "warning";
      }
    }

    return new OverseerCheck({
      ...this.props,
      assessment: {
        ...this.props.assessment,
        status,
        issues: newIssues,
      },
    });
  }

  /**
   * Set the intervention decision.
   */
  withIntervention(intervention: Omit<OverseerIntervention, "executed" | "executedAt">): OverseerCheck {
    return new OverseerCheck({
      ...this.props,
      intervention: {
        ...intervention,
        executed: false,
        executedAt: null,
      },
    });
  }

  /**
   * Mark intervention as executed.
   */
  markInterventionExecuted(): OverseerCheck {
    if (!this.props.intervention) {
      throw new Error("Cannot mark intervention as executed - no intervention set");
    }

    return new OverseerCheck({
      ...this.props,
      intervention: {
        ...this.props.intervention,
        executed: true,
        executedAt: new Date(),
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Serialization
  // ───────────────────────────────────────────────────────────────────────────

  toPlainObject(): OverseerCheckProps {
    return { ...this.props };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface OversightConfig {
  /** Check interval in seconds (default: 30s) */
  checkIntervalSeconds: number;
  /** Maximum cost per task in dollars (default: $10) */
  maxCostPerTask: number;
  /** Maximum time per task in seconds (default: 30 min = 1800s) */
  maxTimePerTask: number;
  /** Number of checks to consider for loop detection (default: 5) */
  loopDetectionWindow: number;
  /** Error count threshold before intervention (default: 10) */
  errorThreshold: number;
  /** Whether to auto-terminate on critical issues (default: false, pause instead) */
  autoTerminate: boolean;
  /** Whether oversight is enabled (default: true) */
  enabled: boolean;
}

export const DEFAULT_OVERSIGHT_CONFIG: OversightConfig = {
  checkIntervalSeconds: 30,
  maxCostPerTask: 10,
  maxTimePerTask: 1800, // 30 minutes
  loopDetectionWindow: 5,
  errorThreshold: 10,
  autoTerminate: false,
  enabled: true,
};
