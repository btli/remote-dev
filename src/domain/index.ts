/**
 * Domain Layer Exports
 *
 * The domain layer contains pure business logic with no dependencies on
 * infrastructure (database, external services, etc).
 */

// Entities
export { Session, type SessionProps, type CreateSessionProps } from "./entities/Session";
export { Folder, type FolderProps, type CreateFolderProps } from "./entities/Folder";

// Value Objects
export { SessionStatus } from "./value-objects/SessionStatus";
export { TmuxSessionName } from "./value-objects/TmuxSessionName";

// Errors
export {
  DomainError,
  InvalidStateTransitionError,
  InvalidValueError,
  EntityNotFoundError,
  BusinessRuleViolationError,
} from "./errors/DomainError";
