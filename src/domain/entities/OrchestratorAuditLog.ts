/**
 * OrchestratorAuditLog - Domain entity representing an immutable audit log entry.
 *
 * An audit log entry records an action performed by an orchestrator,
 * providing a complete audit trail for compliance and debugging.
 *
 * Invariants:
 * - An audit log entry must have a valid orchestrator ID
 * - An audit log entry must have a valid action type
 * - An audit log entry is immutable - once created, it cannot be modified
 * - An audit log entry must have a timestamp
 */

import { InvalidValueError } from "../errors/DomainError";
import type { AuditLogActionType } from "@/types/orchestrator";

export interface OrchestratorAuditLogProps {
  id: string;
  orchestratorId: string;
  actionType: AuditLogActionType;
  targetSessionId: string | null; // Target session (if action is session-specific)
  details: Record<string, unknown> | null; // Structured action details
  createdAt: Date;
}

export interface CreateAuditLogProps {
  id?: string;
  orchestratorId: string;
  actionType: AuditLogActionType;
  targetSessionId?: string | null;
  details?: Record<string, unknown> | null;
}

export class OrchestratorAuditLog {
  private constructor(private readonly props: OrchestratorAuditLogProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    // Validate required fields
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError("OrchestratorAuditLog.id", this.props.id, "Must be a non-empty string");
    }
    if (!this.props.orchestratorId || typeof this.props.orchestratorId !== "string") {
      throw new InvalidValueError(
        "OrchestratorAuditLog.orchestratorId",
        this.props.orchestratorId,
        "Must be a non-empty string"
      );
    }

    // Validate action type
    const validActionTypes = [
      "insight_generated",
      "command_injected",
      "session_monitored",
      "status_changed",
    ];
    if (!validActionTypes.includes(this.props.actionType)) {
      throw new InvalidValueError(
        "OrchestratorAuditLog.actionType",
        this.props.actionType,
        `Must be one of: ${validActionTypes.join(", ")}`
      );
    }

    // Validate timestamp
    if (!(this.props.createdAt instanceof Date) || isNaN(this.props.createdAt.getTime())) {
      throw new InvalidValueError(
        "OrchestratorAuditLog.createdAt",
        this.props.createdAt,
        "Must be a valid Date"
      );
    }
  }

  /**
   * Create a new OrchestratorAuditLog entry.
   * Audit logs are immutable - once created, they cannot be modified.
   */
  static create(props: CreateAuditLogProps): OrchestratorAuditLog {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    return new OrchestratorAuditLog({
      id,
      orchestratorId: props.orchestratorId,
      actionType: props.actionType,
      targetSessionId: props.targetSessionId ?? null,
      details: props.details ?? null,
      createdAt: now,
    });
  }

  /**
   * Reconstitute an OrchestratorAuditLog from persistence.
   * Used by repositories when loading from database.
   */
  static reconstitute(props: OrchestratorAuditLogProps): OrchestratorAuditLog {
    return new OrchestratorAuditLog(props);
  }

  // ============================================================================
  // Factory Methods for Common Actions
  // ============================================================================

  /**
   * Create an audit log entry for insight generation.
   */
  static forInsightGenerated(
    orchestratorId: string,
    insightId: string,
    sessionId: string | null,
    insightType: string,
    severity: string
  ): OrchestratorAuditLog {
    return OrchestratorAuditLog.create({
      orchestratorId,
      actionType: "insight_generated",
      targetSessionId: sessionId,
      details: {
        insightId,
        insightType,
        severity,
      },
    });
  }

  /**
   * Create an audit log entry for command injection.
   */
  static forCommandInjected(
    orchestratorId: string,
    sessionId: string,
    command: string,
    reason?: string
  ): OrchestratorAuditLog {
    return OrchestratorAuditLog.create({
      orchestratorId,
      actionType: "command_injected",
      targetSessionId: sessionId,
      details: {
        command,
        reason: reason ?? null,
      },
    });
  }

  /**
   * Create an audit log entry for session monitoring.
   */
  static forSessionMonitored(
    orchestratorId: string,
    sessionId: string,
    checkResult: "healthy" | "stalled" | "error"
  ): OrchestratorAuditLog {
    return OrchestratorAuditLog.create({
      orchestratorId,
      actionType: "session_monitored",
      targetSessionId: sessionId,
      details: {
        checkResult,
      },
    });
  }

  /**
   * Create an audit log entry for status change.
   */
  static forStatusChanged(
    orchestratorId: string,
    oldStatus: string,
    newStatus: string
  ): OrchestratorAuditLog {
    return OrchestratorAuditLog.create({
      orchestratorId,
      actionType: "status_changed",
      targetSessionId: null,
      details: {
        oldStatus,
        newStatus,
      },
    });
  }

  // ============================================================================
  // Getters
  // ============================================================================

  get id(): string {
    return this.props.id;
  }

  get orchestratorId(): string {
    return this.props.orchestratorId;
  }

  get actionType(): AuditLogActionType {
    return this.props.actionType;
  }

  get targetSessionId(): string | null {
    return this.props.targetSessionId;
  }

  get details(): Record<string, unknown> | null {
    // Return a deep copy to preserve immutability
    return this.props.details ? JSON.parse(JSON.stringify(this.props.details)) : null;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Check if this audit log entry is session-specific.
   */
  isSessionSpecific(): boolean {
    return this.props.targetSessionId !== null;
  }

  /**
   * Check if this is an insight generation entry.
   */
  isInsightGeneration(): boolean {
    return this.props.actionType === "insight_generated";
  }

  /**
   * Check if this is a command injection entry.
   */
  isCommandInjection(): boolean {
    return this.props.actionType === "command_injected";
  }

  /**
   * Check if this is a session monitoring entry.
   */
  isSessionMonitoring(): boolean {
    return this.props.actionType === "session_monitored";
  }

  /**
   * Check if this is a status change entry.
   */
  isStatusChange(): boolean {
    return this.props.actionType === "status_changed";
  }

  /**
   * Get age of audit log entry in milliseconds.
   */
  getAge(): number {
    return Date.now() - this.props.createdAt.getTime();
  }

  /**
   * Get age of audit log entry in seconds.
   */
  getAgeInSeconds(): number {
    return Math.floor(this.getAge() / 1000);
  }

  /**
   * Check if entry is older than a given duration (in seconds).
   */
  isOlderThan(seconds: number): boolean {
    return this.getAgeInSeconds() > seconds;
  }

  /**
   * Get a summary string for logging/display.
   */
  getSummary(): string {
    const sessionInfo = this.props.targetSessionId ? ` (session: ${this.props.targetSessionId})` : "";
    let detailsInfo = "";

    if (this.props.details) {
      if (this.isCommandInjection() && "command" in this.props.details) {
        detailsInfo = ` - command: "${this.props.details.command}"`;
      } else if (this.isInsightGeneration() && "insightType" in this.props.details) {
        detailsInfo = ` - ${this.props.details.insightType} (${this.props.details.severity})`;
      } else if (this.isStatusChange() && "oldStatus" in this.props.details && "newStatus" in this.props.details) {
        detailsInfo = ` - ${this.props.details.oldStatus} → ${this.props.details.newStatus}`;
      }
    }

    return `[${this.props.actionType}]${sessionInfo}${detailsInfo}`;
  }

  /**
   * Get full props (for persistence).
   */
  toProps(): OrchestratorAuditLogProps {
    return { ...this.props };
  }
}
