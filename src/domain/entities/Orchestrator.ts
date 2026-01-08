/**
 * Orchestrator - Domain entity representing an orchestrator agent session.
 *
 * An orchestrator is a special terminal session running an AI agent CLI
 * that monitors other sessions, detects issues, and provides insights.
 *
 * Invariants:
 * - An orchestrator must have a valid session ID
 * - An orchestrator must have a valid type (master or sub_orchestrator)
 * - An orchestrator must have a valid status
 * - Sub-orchestrators must have a scope (folder)
 * - Master orchestrators must not have a scope
 * - Only one master orchestrator per user
 * - Monitoring intervals must be positive
 * - Stall thresholds must be positive
 */

import { InvalidValueError, InvariantViolationError } from "../errors/DomainError";
import type {
  OrchestratorType,
  OrchestratorStatus,
  OrchestratorScopeType,
} from "@/types/orchestrator";

export interface OrchestratorProps {
  id: string;
  sessionId: string; // Link to terminal session
  userId: string;
  type: OrchestratorType;
  status: OrchestratorStatus;
  scopeType: OrchestratorScopeType;
  scopeId: string | null;
  customInstructions: string | null;
  monitoringInterval: number; // seconds
  stallThreshold: number; // seconds
  autoIntervention: boolean;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrchestratorProps {
  id?: string;
  sessionId: string;
  userId: string;
  type: OrchestratorType;
  scopeType?: OrchestratorScopeType;
  scopeId?: string | null;
  customInstructions?: string | null;
  monitoringInterval?: number;
  stallThreshold?: number;
  autoIntervention?: boolean;
}

export class Orchestrator {
  private constructor(private readonly props: OrchestratorProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    // Validate required fields
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError("Orchestrator.id", this.props.id, "Must be a non-empty string");
    }
    if (!this.props.sessionId || typeof this.props.sessionId !== "string") {
      throw new InvalidValueError("Orchestrator.sessionId", this.props.sessionId, "Must be a non-empty string");
    }
    if (!this.props.userId || typeof this.props.userId !== "string") {
      throw new InvalidValueError("Orchestrator.userId", this.props.userId, "Must be a non-empty string");
    }

    // Validate type
    if (this.props.type !== "master" && this.props.type !== "sub_orchestrator") {
      throw new InvalidValueError("Orchestrator.type", this.props.type, "Must be 'master' or 'sub_orchestrator'");
    }

    // Validate status
    const validStatuses = ["idle", "analyzing", "acting", "paused"];
    if (!validStatuses.includes(this.props.status)) {
      throw new InvalidValueError("Orchestrator.status", this.props.status, `Must be one of: ${validStatuses.join(", ")}`);
    }

    // Validate scope rules
    if (this.props.type === "master") {
      if (this.props.scopeType !== null || this.props.scopeId !== null) {
        throw new InvariantViolationError(
          "Master orchestrators must not have a scope",
          "MASTER_WITH_SCOPE"
        );
      }
    } else if (this.props.type === "sub_orchestrator") {
      if (this.props.scopeType !== "folder" || !this.props.scopeId) {
        throw new InvariantViolationError(
          "Sub-orchestrators must have a folder scope",
          "SUB_WITHOUT_SCOPE"
        );
      }
    }

    // Validate monitoring intervals
    if (this.props.monitoringInterval <= 0) {
      throw new InvalidValueError(
        "Orchestrator.monitoringInterval",
        this.props.monitoringInterval,
        "Must be a positive number"
      );
    }
    if (this.props.stallThreshold <= 0) {
      throw new InvalidValueError(
        "Orchestrator.stallThreshold",
        this.props.stallThreshold,
        "Must be a positive number"
      );
    }
  }

  /**
   * Create a new Orchestrator with initial idle status.
   */
  static create(props: CreateOrchestratorProps): Orchestrator {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    // Set defaults based on orchestrator type
    const scopeType = props.type === "master" ? null : (props.scopeType ?? "folder");
    const scopeId = props.type === "master" ? null : props.scopeId ?? null;

    return new Orchestrator({
      id,
      sessionId: props.sessionId,
      userId: props.userId,
      type: props.type,
      status: "idle",
      scopeType,
      scopeId,
      customInstructions: props.customInstructions ?? null,
      monitoringInterval: props.monitoringInterval ?? 30, // 30 seconds default
      stallThreshold: props.stallThreshold ?? 300, // 5 minutes default
      autoIntervention: props.autoIntervention ?? false,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Create a master orchestrator.
   */
  static createMaster(props: {
    sessionId: string;
    userId: string;
    customInstructions?: string;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }): Orchestrator {
    return Orchestrator.create({
      ...props,
      type: "master",
      scopeType: null,
      scopeId: null,
    });
  }

  /**
   * Create a sub-orchestrator.
   */
  static createSubOrchestrator(props: {
    sessionId: string;
    userId: string;
    scopeId: string;
    customInstructions?: string;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }): Orchestrator {
    return Orchestrator.create({
      ...props,
      type: "sub_orchestrator",
      scopeType: "folder",
    });
  }

  /**
   * Reconstitute an Orchestrator from persistence.
   * Used by repositories when loading from database.
   */
  static reconstitute(props: OrchestratorProps): Orchestrator {
    return new Orchestrator(props);
  }

  // ============================================================================
  // Getters
  // ============================================================================

  get id(): string {
    return this.props.id;
  }

  get sessionId(): string {
    return this.props.sessionId;
  }

  get userId(): string {
    return this.props.userId;
  }

  get type(): OrchestratorType {
    return this.props.type;
  }

  get status(): OrchestratorStatus {
    return this.props.status;
  }

  get scopeType(): OrchestratorScopeType {
    return this.props.scopeType;
  }

  get scopeId(): string | null {
    return this.props.scopeId;
  }

  get customInstructions(): string | null {
    return this.props.customInstructions;
  }

  get monitoringInterval(): number {
    return this.props.monitoringInterval;
  }

  get stallThreshold(): number {
    return this.props.stallThreshold;
  }

  get autoIntervention(): boolean {
    return this.props.autoIntervention;
  }

  get lastActivityAt(): Date {
    return new Date(this.props.lastActivityAt.getTime());
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  // ============================================================================
  // Business Logic Methods
  // ============================================================================

  /**
   * Check if this is a master orchestrator.
   */
  isMaster(): boolean {
    return this.props.type === "master";
  }

  /**
   * Check if this is a sub-orchestrator.
   */
  isSubOrchestrator(): boolean {
    return this.props.type === "sub_orchestrator";
  }

  /**
   * Check if orchestrator is currently active (not paused).
   */
  isActive(): boolean {
    return this.props.status !== "paused";
  }

  /**
   * Check if orchestrator is currently monitoring.
   */
  isMonitoring(): boolean {
    return this.props.status === "idle" || this.props.status === "analyzing";
  }

  /**
   * Check if orchestrator is paused.
   */
  isPaused(): boolean {
    return this.props.status === "paused";
  }

  /**
   * Check if orchestrator is idle.
   */
  isIdle(): boolean {
    return this.props.status === "idle";
  }

  /**
   * Check if a session is within this orchestrator's scope.
   */
  isInScope(sessionFolderId: string | null): boolean {
    if (this.isMaster()) {
      // Master orchestrators monitor all sessions
      return true;
    }

    // Sub-orchestrators only monitor sessions in their scope
    return sessionFolderId === this.props.scopeId;
  }

  /**
   * Pause monitoring.
   * Returns a new Orchestrator instance with paused status.
   */
  pause(): Orchestrator {
    if (this.props.status === "paused") {
      return this; // Already paused
    }

    return new Orchestrator({
      ...this.props,
      status: "paused",
      updatedAt: new Date(),
    });
  }

  /**
   * Resume monitoring.
   * Returns a new Orchestrator instance with idle status.
   */
  resume(): Orchestrator {
    if (this.props.status !== "paused") {
      return this; // Not paused, nothing to resume
    }

    return new Orchestrator({
      ...this.props,
      status: "idle",
      updatedAt: new Date(),
    });
  }

  /**
   * Start analyzing sessions.
   * Returns a new Orchestrator instance with analyzing status.
   */
  startAnalyzing(): Orchestrator {
    if (this.props.status === "paused") {
      throw new InvariantViolationError(
        "Cannot start analyzing while paused",
        "PAUSED_ORCHESTRATOR"
      );
    }

    return new Orchestrator({
      ...this.props,
      status: "analyzing",
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Start acting on insights.
   * Returns a new Orchestrator instance with acting status.
   */
  startActing(): Orchestrator {
    if (this.props.status === "paused") {
      throw new InvariantViolationError(
        "Cannot start acting while paused",
        "PAUSED_ORCHESTRATOR"
      );
    }

    return new Orchestrator({
      ...this.props,
      status: "acting",
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Return to idle state after analysis/action.
   * Returns a new Orchestrator instance with idle status.
   */
  returnToIdle(): Orchestrator {
    if (this.props.status === "idle") {
      return this; // Already idle
    }

    if (this.props.status === "paused") {
      throw new InvariantViolationError(
        "Cannot return to idle from paused state - use resume() instead",
        "PAUSED_ORCHESTRATOR"
      );
    }

    return new Orchestrator({
      ...this.props,
      status: "idle",
      updatedAt: new Date(),
    });
  }

  /**
   * Update configuration.
   * Returns a new Orchestrator instance with updated config.
   */
  updateConfig(updates: {
    customInstructions?: string | null;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }): Orchestrator {
    const newProps = { ...this.props };

    if (updates.customInstructions !== undefined) {
      newProps.customInstructions = updates.customInstructions;
    }
    if (updates.monitoringInterval !== undefined) {
      if (updates.monitoringInterval <= 0) {
        throw new InvalidValueError(
          "monitoringInterval",
          updates.monitoringInterval,
          "Must be positive"
        );
      }
      newProps.monitoringInterval = updates.monitoringInterval;
    }
    if (updates.stallThreshold !== undefined) {
      if (updates.stallThreshold <= 0) {
        throw new InvalidValueError(
          "stallThreshold",
          updates.stallThreshold,
          "Must be positive"
        );
      }
      newProps.stallThreshold = updates.stallThreshold;
    }
    if (updates.autoIntervention !== undefined) {
      newProps.autoIntervention = updates.autoIntervention;
    }

    newProps.updatedAt = new Date();

    return new Orchestrator(newProps);
  }

  /**
   * Touch activity timestamp.
   * Returns a new Orchestrator instance with updated lastActivityAt.
   */
  touch(): Orchestrator {
    return new Orchestrator({
      ...this.props,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Get full props (for persistence).
   */
  toProps(): OrchestratorProps {
    return { ...this.props };
  }
}
