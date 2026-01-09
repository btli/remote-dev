/**
 * Domain Layer Exports
 *
 * The domain layer contains pure business logic with no dependencies on
 * infrastructure (database, external services, etc).
 */

// Entities
export { Session, type SessionProps, type CreateSessionProps } from "./entities/Session";
export { Folder, type FolderProps, type CreateFolderProps } from "./entities/Folder";
export {
  Task,
  type TaskProps,
  type CreateTaskProps,
  type TaskResult,
  type TaskError,
} from "./entities/Task";
export {
  Delegation,
  type DelegationProps,
  type CreateDelegationProps,
  type DelegationResult,
  type DelegationError,
  type LogEntry,
} from "./entities/Delegation";
export {
  ProjectKnowledge,
  type ProjectKnowledgeProps,
  type CreateProjectKnowledgeProps,
  type Convention,
  type LearnedPattern,
  type SkillDefinition,
  type ToolDefinition,
  type ProjectKnowledgeMetadata,
  type AgentPerformanceMap,
} from "./entities/ProjectKnowledge";

// Value Objects
export { SessionStatus } from "./value-objects/SessionStatus";
export { TmuxSessionName } from "./value-objects/TmuxSessionName";
export { TaskStatus } from "./value-objects/TaskStatus";
export { TaskType } from "./value-objects/TaskType";
export { AutonomyLevel } from "./value-objects/AutonomyLevel";

// Errors
export {
  DomainError,
  InvalidStateTransitionError,
  InvalidValueError,
  EntityNotFoundError,
  BusinessRuleViolationError,
} from "./errors/DomainError";
export {
  TaskParsingError,
  TaskExecutionError,
  NoSuitableAgentError,
  DelegationError as DelegationDomainError,
  ContextInjectionError,
  TranscriptAnalysisError,
  SkillVerificationError,
  ToolGenerationError,
  BeadsOperationError,
  KnowledgeUpdateError,
} from "./errors/TaskErrors";
