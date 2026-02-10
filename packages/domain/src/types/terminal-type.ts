/**
 * Terminal Type System - Core types for extensible terminal plugin architecture
 * Pure TypeScript - no React dependencies
 */

import type { AgentProviderType } from "./session";

/**
 * Terminal type identifiers
 * - shell: Standard terminal with bash/zsh shell
 * - agent: AI agent running as the shell (exits when agent exits)
 * - file: Read/edit file without terminal (CLAUDE.md editor)
 * - Custom types can be added via plugin registration
 */
export type TerminalType = "shell" | "agent" | "file" | string;

/**
 * Built-in terminal types (cannot be unregistered)
 */
export const BUILT_IN_TERMINAL_TYPES: TerminalType[] = ["shell", "agent", "file"];

/**
 * Session exit behavior determines what happens when the main process exits
 */
export interface ExitBehavior {
  /** Show exit screen with options (restart, delete, etc.) */
  showExitScreen: boolean;
  /** Allow manual restart from exit screen */
  canRestart: boolean;
  /** Automatically mark session as closed */
  autoClose: boolean;
  /** Custom exit message */
  exitMessage?: string;
}

/**
 * Configuration returned by plugin when creating a session
 */
export interface SessionConfig {
  /** Command to run as the shell (null = use default shell) */
  shellCommand: string | null;
  /** Arguments for the shell command */
  shellArgs: string[];
  /** Environment variables to inject */
  environment: Record<string, string>;
  /** Working directory override */
  cwd?: string;
  /** Whether to create a tmux session (false for file viewer) */
  useTmux: boolean;
  /** Additional metadata stored with session */
  metadata?: AgentSessionMetadata | FileViewerMetadata | Record<string, unknown>;
}

/**
 * Session lifecycle events
 */
export type SessionEventType =
  | "session:created"
  | "session:attached"
  | "session:detached"
  | "session:exited"
  | "session:restarted"
  | "session:closed"
  | "session:error";

/**
 * Session event payload
 */
export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  terminalType: TerminalType;
  timestamp: Date;
  data?: {
    exitCode?: number | null;
    error?: Error;
    previousState?: string;
    newState?: string;
  };
}

/**
 * Agent exit state for tracking in database
 */
export type AgentExitState = "running" | "exited" | "restarting" | "closed";

/**
 * Agent session metadata stored with the session
 */
export interface AgentSessionMetadata {
  agentProvider: AgentProviderType;
  exitState: AgentExitState;
  exitCode: number | null;
  exitedAt: Date | null;
  restartCount: number;
  lastStartedAt: Date;
}

/**
 * File viewer metadata stored with the session
 */
export interface FileViewerMetadata {
  filePath: string;
  fileName: string;
  isAgentConfig: boolean;
  lastSavedAt: Date | null;
  isDirty: boolean;
}

/**
 * Plugin metadata for registry
 */
export interface PluginMetadata {
  type: TerminalType;
  displayName: string;
  description: string;
  priority: number;
  builtIn: boolean;
  registeredAt: Date;
}

/**
 * Terminal type display configuration (without React icon)
 */
export interface TerminalTypeInfo {
  type: TerminalType;
  displayName: string;
  description: string;
  iconName: string; // Icon name instead of React component
}
