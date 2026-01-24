/**
 * Domain Errors
 *
 * All domain-specific errors that represent business rule violations,
 * invalid state transitions, and validation failures.
 */

export {
  DomainError,
  InvalidStateTransitionError,
  InvalidValueError,
  EntityNotFoundError,
  BusinessRuleViolationError,
} from "./DomainError";

export { PortConflictError, type PortConflict } from "./PortConflictError";
