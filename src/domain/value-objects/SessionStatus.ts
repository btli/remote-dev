/**
 * SessionStatus - Value object representing the lifecycle state of a terminal session.
 *
 * State machine:
 *   active ←→ suspended
 *   active → closed
 *   active → trashed
 *   suspended → closed
 *   suspended → trashed
 *   closed → trashed
 *   trashed → (terminal state, can only be permanently deleted)
 */

import { InvalidValueError, InvalidStateTransitionError } from "../errors/DomainError";

const VALID_STATUSES = ["active", "suspended", "closed", "trashed"] as const;
type StatusValue = (typeof VALID_STATUSES)[number];

// Valid state transitions map
const ALLOWED_TRANSITIONS: Record<StatusValue, StatusValue[]> = {
  active: ["suspended", "closed", "trashed"],
  suspended: ["active", "closed", "trashed"],
  closed: ["trashed"],
  trashed: [], // Terminal state
};

export class SessionStatus {
  private constructor(private readonly value: StatusValue) {}

  /**
   * Create a SessionStatus from a string value.
   * @throws InvalidValueError if the value is not a valid status
   */
  static fromString(value: string): SessionStatus {
    if (!VALID_STATUSES.includes(value as StatusValue)) {
      throw new InvalidValueError(
        "SessionStatus",
        value,
        `Must be one of: ${VALID_STATUSES.join(", ")}`
      );
    }
    return new SessionStatus(value as StatusValue);
  }

  /** Create an active status (initial state for new sessions) */
  static active(): SessionStatus {
    return new SessionStatus("active");
  }

  /** Create a suspended status */
  static suspended(): SessionStatus {
    return new SessionStatus("suspended");
  }

  /** Create a closed status */
  static closed(): SessionStatus {
    return new SessionStatus("closed");
  }

  /** Create a trashed status */
  static trashed(): SessionStatus {
    return new SessionStatus("trashed");
  }

  /** Get the string value of this status */
  toString(): StatusValue {
    return this.value;
  }

  /** Check if this status is active */
  isActive(): boolean {
    return this.value === "active";
  }

  /** Check if this status is suspended */
  isSuspended(): boolean {
    return this.value === "suspended";
  }

  /** Check if this status is closed */
  isClosed(): boolean {
    return this.value === "closed";
  }

  /** Check if this status is trashed */
  isTrashed(): boolean {
    return this.value === "trashed";
  }

  /** Check if this status represents a terminal state (session ended) */
  isTerminal(): boolean {
    return this.value === "closed" || this.value === "trashed";
  }

  /** Check if this status allows the session to be resumed */
  canResume(): boolean {
    return this.value === "suspended";
  }

  /** Check if this status allows the session to be suspended */
  canSuspend(): boolean {
    return this.value === "active";
  }

  /**
   * Check if a transition to the target status is valid.
   */
  canTransitionTo(target: SessionStatus): boolean {
    return ALLOWED_TRANSITIONS[this.value].includes(target.value);
  }

  /**
   * Validate that a transition to the target status is allowed.
   * @throws InvalidStateTransitionError if the transition is not valid
   */
  validateTransitionTo(target: SessionStatus, action: string): void {
    if (!this.canTransitionTo(target)) {
      throw new InvalidStateTransitionError(
        action,
        this.value,
        ALLOWED_TRANSITIONS[this.value]
      );
    }
  }

  /** Value equality */
  equals(other: SessionStatus): boolean {
    return this.value === other.value;
  }
}
