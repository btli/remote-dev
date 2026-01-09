/**
 * TaskStatus - Value object representing the lifecycle state of an orchestrator task.
 *
 * State machine:
 *   queued → planning → executing → monitoring → completed
 *                                              → failed
 *                                              → cancelled
 *   queued → cancelled
 *   planning → cancelled
 *   executing → cancelled
 *   monitoring → cancelled
 */

import { InvalidValueError, InvalidStateTransitionError } from "../errors/DomainError";

const VALID_STATUSES = [
  "queued",
  "planning",
  "executing",
  "monitoring",
  "completed",
  "failed",
  "cancelled",
] as const;
type StatusValue = (typeof VALID_STATUSES)[number];

// Valid state transitions map
const ALLOWED_TRANSITIONS: Record<StatusValue, StatusValue[]> = {
  queued: ["planning", "cancelled"],
  planning: ["executing", "cancelled", "failed"],
  executing: ["monitoring", "cancelled", "failed"],
  monitoring: ["completed", "failed", "cancelled"],
  completed: [], // Terminal state
  failed: [], // Terminal state
  cancelled: [], // Terminal state
};

export class TaskStatus {
  private constructor(private readonly value: StatusValue) {}

  /**
   * Create a TaskStatus from a string value.
   * @throws InvalidValueError if the value is not a valid status
   */
  static fromString(value: string): TaskStatus {
    if (!VALID_STATUSES.includes(value as StatusValue)) {
      throw new InvalidValueError(
        "TaskStatus",
        value,
        `Must be one of: ${VALID_STATUSES.join(", ")}`
      );
    }
    return new TaskStatus(value as StatusValue);
  }

  /** Create a queued status (initial state for new tasks) */
  static queued(): TaskStatus {
    return new TaskStatus("queued");
  }

  /** Create a planning status */
  static planning(): TaskStatus {
    return new TaskStatus("planning");
  }

  /** Create an executing status */
  static executing(): TaskStatus {
    return new TaskStatus("executing");
  }

  /** Create a monitoring status */
  static monitoring(): TaskStatus {
    return new TaskStatus("monitoring");
  }

  /** Create a completed status */
  static completed(): TaskStatus {
    return new TaskStatus("completed");
  }

  /** Create a failed status */
  static failed(): TaskStatus {
    return new TaskStatus("failed");
  }

  /** Create a cancelled status */
  static cancelled(): TaskStatus {
    return new TaskStatus("cancelled");
  }

  /** Get the string value of this status */
  toString(): StatusValue {
    return this.value;
  }

  /** Check if this status is queued */
  isQueued(): boolean {
    return this.value === "queued";
  }

  /** Check if this status is planning */
  isPlanning(): boolean {
    return this.value === "planning";
  }

  /** Check if this status is executing */
  isExecuting(): boolean {
    return this.value === "executing";
  }

  /** Check if this status is monitoring */
  isMonitoring(): boolean {
    return this.value === "monitoring";
  }

  /** Check if this status is completed */
  isCompleted(): boolean {
    return this.value === "completed";
  }

  /** Check if this status is failed */
  isFailed(): boolean {
    return this.value === "failed";
  }

  /** Check if this status is cancelled */
  isCancelled(): boolean {
    return this.value === "cancelled";
  }

  /** Check if this status represents a terminal state */
  isTerminal(): boolean {
    return this.value === "completed" || this.value === "failed" || this.value === "cancelled";
  }

  /** Check if this status represents an active state (work in progress) */
  isActive(): boolean {
    return !this.isTerminal() && !this.isQueued();
  }

  /** Check if this status allows cancellation */
  canCancel(): boolean {
    return !this.isTerminal();
  }

  /**
   * Check if a transition to the target status is valid.
   */
  canTransitionTo(target: TaskStatus): boolean {
    return ALLOWED_TRANSITIONS[this.value].includes(target.value);
  }

  /**
   * Validate that a transition to the target status is allowed.
   * @throws InvalidStateTransitionError if the transition is not valid
   */
  validateTransitionTo(target: TaskStatus, action: string): void {
    if (!this.canTransitionTo(target)) {
      throw new InvalidStateTransitionError(
        action,
        this.value,
        ALLOWED_TRANSITIONS[this.value]
      );
    }
  }

  /** Value equality */
  equals(other: TaskStatus): boolean {
    return this.value === other.value;
  }
}
