/**
 * Task - Domain entity representing an orchestrator task.
 *
 * A Task is a unit of work that the orchestrator delegates to an agent.
 * It tracks the lifecycle from queued through execution to completion.
 *
 * This entity is immutable - state changes return a new Task instance.
 *
 * Invariants:
 * - A task must have a valid description
 * - A task must have a valid type
 * - A task must have a valid status
 * - State transitions must follow the state machine rules
 * - A task can only be assigned to one delegation at a time
 */

import { TaskStatus } from "../value-objects/TaskStatus";
import { TaskType } from "../value-objects/TaskType";
import { InvalidValueError } from "../errors/DomainError";
import type { AgentProviderType } from "@/types/session";

export interface TaskProps {
  id: string;
  orchestratorId: string;
  userId: string;
  folderId: string | null;
  description: string;
  type: TaskType;
  status: TaskStatus;
  confidence: number; // 0-1, how confident the parsing was
  estimatedDuration: number | null; // seconds
  assignedAgent: AgentProviderType | null;
  delegationId: string | null;
  beadsIssueId: string | null; // Link to beads issue
  contextInjected: string | null; // Context that was/will be injected
  result: TaskResult | null;
  error: TaskError | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface TaskResult {
  success: boolean;
  summary: string;
  filesModified: string[];
  learnings: string[];
}

export interface TaskError {
  code: string;
  message: string;
  stack?: string;
  recoverable: boolean;
}

export interface CreateTaskProps {
  id?: string;
  orchestratorId: string;
  userId: string;
  folderId?: string | null;
  description: string;
  type: TaskType;
  confidence?: number;
  estimatedDuration?: number | null;
  beadsIssueId?: string | null;
}

export class Task {
  private constructor(private readonly props: TaskProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError("Task.id", this.props.id, "Must be a non-empty string");
    }
    if (!this.props.orchestratorId || typeof this.props.orchestratorId !== "string") {
      throw new InvalidValueError(
        "Task.orchestratorId",
        this.props.orchestratorId,
        "Must be a non-empty string"
      );
    }
    if (!this.props.userId || typeof this.props.userId !== "string") {
      throw new InvalidValueError("Task.userId", this.props.userId, "Must be a non-empty string");
    }
    if (!this.props.description || typeof this.props.description !== "string") {
      throw new InvalidValueError(
        "Task.description",
        this.props.description,
        "Must be a non-empty string"
      );
    }
    if (this.props.confidence < 0 || this.props.confidence > 1) {
      throw new InvalidValueError(
        "Task.confidence",
        this.props.confidence,
        "Must be between 0 and 1"
      );
    }
  }

  /**
   * Create a new Task with initial queued status.
   */
  static create(props: CreateTaskProps): Task {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    return new Task({
      id,
      orchestratorId: props.orchestratorId,
      userId: props.userId,
      folderId: props.folderId ?? null,
      description: props.description,
      type: props.type,
      status: TaskStatus.queued(),
      confidence: props.confidence ?? 1.0,
      estimatedDuration: props.estimatedDuration ?? null,
      assignedAgent: null,
      delegationId: null,
      beadsIssueId: props.beadsIssueId ?? null,
      contextInjected: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
  }

  /**
   * Reconstitute a Task from persisted data.
   */
  static reconstitute(props: TaskProps): Task {
    return new Task(props);
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

  get userId(): string {
    return this.props.userId;
  }

  get folderId(): string | null {
    return this.props.folderId;
  }

  get description(): string {
    return this.props.description;
  }

  get type(): TaskType {
    return this.props.type;
  }

  get status(): TaskStatus {
    return this.props.status;
  }

  get confidence(): number {
    return this.props.confidence;
  }

  get estimatedDuration(): number | null {
    return this.props.estimatedDuration;
  }

  get assignedAgent(): AgentProviderType | null {
    return this.props.assignedAgent;
  }

  get delegationId(): string | null {
    return this.props.delegationId;
  }

  get beadsIssueId(): string | null {
    return this.props.beadsIssueId;
  }

  get contextInjected(): string | null {
    return this.props.contextInjected;
  }

  get result(): TaskResult | null {
    return this.props.result;
  }

  get error(): TaskError | null {
    return this.props.error;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get completedAt(): Date | null {
    return this.props.completedAt;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain Methods (state transitions)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Start planning phase.
   */
  startPlanning(): Task {
    this.props.status.validateTransitionTo(TaskStatus.planning(), "startPlanning");
    return this.withUpdates({
      status: TaskStatus.planning(),
    });
  }

  /**
   * Assign an agent and start execution.
   */
  startExecution(agent: AgentProviderType, context: string): Task {
    this.props.status.validateTransitionTo(TaskStatus.executing(), "startExecution");
    return this.withUpdates({
      status: TaskStatus.executing(),
      assignedAgent: agent,
      contextInjected: context,
    });
  }

  /**
   * Attach a delegation (spawned session).
   */
  attachDelegation(delegationId: string): Task {
    if (!this.status.isExecuting() && !this.status.isMonitoring()) {
      throw new InvalidValueError(
        "Task.status",
        this.status.toString(),
        "Must be in executing or monitoring state to attach delegation"
      );
    }
    return this.withUpdates({
      delegationId,
    });
  }

  /**
   * Start monitoring the delegation.
   */
  startMonitoring(): Task {
    this.props.status.validateTransitionTo(TaskStatus.monitoring(), "startMonitoring");
    return this.withUpdates({
      status: TaskStatus.monitoring(),
    });
  }

  /**
   * Mark task as completed successfully.
   */
  complete(result: TaskResult): Task {
    this.props.status.validateTransitionTo(TaskStatus.completed(), "complete");
    return this.withUpdates({
      status: TaskStatus.completed(),
      result,
      completedAt: new Date(),
    });
  }

  /**
   * Mark task as failed.
   */
  fail(error: TaskError): Task {
    this.props.status.validateTransitionTo(TaskStatus.failed(), "fail");
    return this.withUpdates({
      status: TaskStatus.failed(),
      error,
      completedAt: new Date(),
    });
  }

  /**
   * Cancel the task.
   */
  cancel(): Task {
    this.props.status.validateTransitionTo(TaskStatus.cancelled(), "cancel");
    return this.withUpdates({
      status: TaskStatus.cancelled(),
      completedAt: new Date(),
    });
  }

  /**
   * Link to a beads issue.
   */
  linkToBeadsIssue(issueId: string): Task {
    return this.withUpdates({
      beadsIssueId: issueId,
    });
  }

  /**
   * Update the description.
   */
  updateDescription(description: string): Task {
    if (!description || typeof description !== "string" || !description.trim()) {
      throw new InvalidValueError("description", description, "Must be a non-empty string");
    }
    return this.withUpdates({ description: description.trim() });
  }

  /**
   * Update estimated duration.
   */
  setEstimatedDuration(seconds: number): Task {
    return this.withUpdates({ estimatedDuration: seconds });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /** Check if task is in a terminal state */
  isTerminal(): boolean {
    return this.props.status.isTerminal();
  }

  /** Check if task is actively being worked on */
  isActive(): boolean {
    return this.props.status.isActive();
  }

  /** Check if task is waiting in queue */
  isQueued(): boolean {
    return this.props.status.isQueued();
  }

  /** Check if task is in planning state */
  isPlanning(): boolean {
    return this.props.status.isPlanning();
  }

  /** Check if task can be cancelled */
  canCancel(): boolean {
    return this.props.status.canCancel();
  }

  /** Check if task has a delegation */
  hasDelegation(): boolean {
    return this.props.delegationId !== null;
  }

  /** Check if task has a linked beads issue */
  hasBeadsIssue(): boolean {
    return this.props.beadsIssueId !== null;
  }

  /** Check if task completed successfully */
  isSuccessful(): boolean {
    return this.props.status.isCompleted() && this.props.result?.success === true;
  }

  /** Get recommended agents based on task type */
  getRecommendedAgents(): string[] {
    return this.props.type.getRecommendedAgents();
  }

  /** Check if task belongs to specified user */
  belongsTo(userId: string): boolean {
    return this.props.userId === userId;
  }

  /** Check if this task equals another */
  equals(other: Task): boolean {
    return (
      this.id === other.id &&
      this.orchestratorId === other.orchestratorId &&
      this.description === other.description &&
      this.type.equals(other.type) &&
      this.status.equals(other.status)
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private withUpdates(updates: Partial<TaskProps>): Task {
    return new Task({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }

  /**
   * Convert to plain object for serialization.
   */
  toPlainObject(): Omit<TaskProps, "type" | "status"> & {
    type: string;
    status: string;
  } {
    const { type, status, ...rest } = this.props;
    return {
      ...rest,
      type: type.toString(),
      status: status.toString(),
    };
  }
}
