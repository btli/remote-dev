/**
 * Domain types - pure TypeScript interfaces and type definitions
 */

// Session types
export type {
  SessionStatusType,
  AgentProviderType,
  TerminalSessionDTO,
  CreateSessionInput,
  UpdateSessionInput,
  AgentProviderConfig,
} from "./session";
export { AGENT_PROVIDERS } from "./session";

// Terminal type system
export type {
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
} from "./terminal-type";
export { BUILT_IN_TERMINAL_TYPES } from "./terminal-type";

// Folder types
export type {
  FolderDTO,
  CreateFolderInput,
  UpdateFolderInput,
  FolderTreeNode,
  PinnedFile,
} from "./folder";
