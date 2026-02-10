/**
 * @remote-dev/domain
 *
 * Shared domain layer for Remote Dev - entities, value objects, and business rules.
 * This package contains pure TypeScript code with no framework dependencies,
 * enabling sharing between web (Next.js) and mobile (React Native) applications.
 */

// Entities
export { Session, Folder } from "./entities";
export type { SessionProps, CreateSessionProps, FolderProps, CreateFolderProps } from "./entities";

// Value Objects
export { SessionStatus, TmuxSessionName } from "./value-objects";

// Errors
export {
  DomainError,
  InvalidStateTransitionError,
  InvalidValueError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  AuthenticationError,
  NetworkError,
  BiometricError,
} from "./errors";

// Types
export type {
  // Session types
  SessionStatusType,
  AgentProviderType,
  TerminalSessionDTO,
  CreateSessionInput,
  UpdateSessionInput,
  AgentProviderConfig,
  // Terminal type system
  TerminalType,
  ExitBehavior,
  SessionConfig,
  SessionEventType,
  SessionEvent,
  AgentExitState,
  AgentSessionMetadata,
  FileViewerMetadata,
  PluginMetadata,
  TerminalTypeInfo,
  // Folder types
  FolderDTO,
  CreateFolderInput,
  UpdateFolderInput,
  FolderTreeNode,
  PinnedFile,
} from "./types";

export { AGENT_PROVIDERS, BUILT_IN_TERMINAL_TYPES } from "./types";
