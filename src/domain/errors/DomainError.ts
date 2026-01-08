/**
 * Base class for all domain errors.
 * Domain errors represent business rule violations and invalid state transitions.
 */
export abstract class DomainError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when an entity state transition is not allowed.
 * Example: Trying to suspend an already suspended session.
 */
export class InvalidStateTransitionError extends DomainError {
  constructor(
    public readonly action: string,
    public readonly currentState: string,
    public readonly allowedStates?: string[]
  ) {
    const allowedMsg = allowedStates
      ? ` Allowed states: ${allowedStates.join(", ")}`
      : "";
    super(
      `Cannot ${action} from state '${currentState}'.${allowedMsg}`,
      "INVALID_STATE_TRANSITION"
    );
  }
}

/**
 * Thrown when a value object validation fails.
 * Example: Invalid tmux session name format.
 */
export class InvalidValueError extends DomainError {
  constructor(
    public readonly valueName: string,
    public readonly value: unknown,
    public readonly reason: string
  ) {
    super(`Invalid ${valueName}: ${reason}`, "INVALID_VALUE");
  }
}

/**
 * Thrown when an entity is not found.
 */
export class EntityNotFoundError extends DomainError {
  constructor(
    public readonly entityType: string,
    public readonly entityId: string
  ) {
    super(`${entityType} not found: ${entityId}`, "ENTITY_NOT_FOUND");
  }
}

/**
 * Thrown when an operation would violate a business rule.
 * Example: Creating a circular folder reference.
 */
export class BusinessRuleViolationError extends DomainError {
  constructor(
    public readonly rule: string,
    public readonly details?: string
  ) {
    super(
      `Business rule violation: ${rule}${details ? ` - ${details}` : ""}`,
      "BUSINESS_RULE_VIOLATION"
    );
  }
}

/**
 * Thrown when an entity invariant is violated.
 * Example: Master orchestrator with a scope, or sub-orchestrator without a scope.
 */
export class InvariantViolationError extends DomainError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}
