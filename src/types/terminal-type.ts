/**
 * Terminal Type System - Core types for extensible terminal plugin architecture
 *
 * This module defines the type system for the plugin-based terminal architecture.
 * Supports different terminal types: shell, agent, file viewer, and custom extensions.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentProviderType, TerminalSession, CreateSessionInput } from "./session";

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
 * Session lifecycle events emitted by the event bus
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
 * Session event payload with type-safe data
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
 * Event handler for session lifecycle events
 */
export type SessionEventHandler = (event: SessionEvent) => void | Promise<void>;

/**
 * Terminal type plugin interface - implement this to create a new terminal type
 *
 * Each plugin is responsible for:
 * - Defining how sessions of this type are created
 * - Handling exit behavior
 * - Providing UI components for the terminal view
 */
export interface TerminalTypePlugin {
  /**
   * Unique identifier for this terminal type
   */
  readonly type: TerminalType;

  /**
   * Human-readable display name
   */
  readonly displayName: string;

  /**
   * Short description of what this type does
   */
  readonly description: string;

  /**
   * Icon to display in sidebar and tabs
   */
  readonly icon: LucideIcon;

  /**
   * Plugin priority (higher = listed first in UI)
   * @default 0
   */
  readonly priority?: number;

  /**
   * Whether this plugin is a built-in type (cannot be unregistered)
   */
  readonly builtIn?: boolean;

  // ============= Lifecycle Methods =============

  /**
   * Called when creating a session of this type
   * Returns configuration for how the session should be set up
   *
   * @param input - User input from session creation wizard
   * @param session - The session entity being created (partial, ID assigned)
   */
  createSession(
    input: CreateSessionInput,
    session: Partial<TerminalSession>
  ): Promise<SessionConfig> | SessionConfig;

  /**
   * Called when the main process exits (agent exits, shell exits, etc.)
   * Return exit behavior to control what happens next
   *
   * @param session - The session that exited
   * @param exitCode - Exit code from the process (null if unknown)
   */
  onSessionExit?(
    session: TerminalSession,
    exitCode: number | null
  ): ExitBehavior;

  /**
   * Called when user requests restart from exit screen
   * Return new session config or null to prevent restart
   *
   * @param session - The session to restart
   */
  onSessionRestart?(
    session: TerminalSession
  ): Promise<SessionConfig | null> | SessionConfig | null;

  /**
   * Called when session is being closed/deleted
   * Use for cleanup (delete temp files, etc.)
   *
   * @param session - The session being closed
   */
  onSessionClose?(session: TerminalSession): Promise<void> | void;

  // ============= UI Methods =============

  /**
   * Render the main content area for this terminal type
   * For shell/agent: wrapped Terminal component
   * For file: markdown editor
   *
   * @param session - The session to render
   * @param props - Additional props passed from parent
   */
  renderContent(
    session: TerminalSession,
    props: TerminalRenderProps
  ): ReactNode;

  /**
   * Render the exit screen shown when session process exits
   * Only called if onSessionExit returns showExitScreen: true
   *
   * @param session - The session that exited
   * @param exitInfo - Information about the exit
   * @param callbacks - Callbacks for user actions
   */
  renderExitScreen?(
    session: TerminalSession,
    exitInfo: ExitScreenInfo,
    callbacks: ExitScreenCallbacks
  ): ReactNode;

  // ============= Validation Methods =============

  /**
   * Validate session creation input before creating
   * Return error message or null if valid
   */
  validateInput?(input: CreateSessionInput): string | null;

  /**
   * Check if this plugin can handle a given session
   * Used during migration and for session compatibility checks
   */
  canHandle?(session: TerminalSession): boolean;
}

/**
 * Props passed to renderContent
 */
export interface TerminalRenderProps {
  /** WebSocket URL for terminal connection */
  wsUrl: string | null;
  /** Session token for auth */
  sessionToken: string | null;
  /** Terminal dimensions */
  cols: number;
  rows: number;
  /** Font size from preferences */
  fontSize: number;
  /** Font family from preferences */
  fontFamily: string;
  /** Whether session is active (vs suspended) */
  isActive: boolean;
  /** Callback when terminal resizes */
  onResize?: (cols: number, rows: number) => void;
  /** Callback when terminal data received */
  onData?: (data: string) => void;
}

/**
 * Information passed to exit screen
 */
export interface ExitScreenInfo {
  exitCode: number | null;
  exitedAt: Date;
  runDuration: number; // milliseconds
  lastOutput?: string; // Last few lines of output
}

/**
 * Callbacks for exit screen actions
 */
export interface ExitScreenCallbacks {
  /** Restart the session with same config */
  onRestart: () => void;
  /** Close and delete the session */
  onClose: () => void;
  /** View session output/logs */
  onViewLogs?: () => void;
  /** Copy last output to clipboard */
  onCopyOutput?: () => void;
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
 * Session with terminal type information
 * Note: TerminalSession already includes terminalType and typeMetadata
 * This alias is kept for backwards compatibility
 */
export type TypedTerminalSession = TerminalSession;

/**
 * Extended CreateSessionInput with terminal type
 */
export interface CreateTypedSessionInput extends CreateSessionInput {
  terminalType?: TerminalType;
  /** For file type: path to file being edited */
  filePath?: string;
  /** For agent type: whether agent is the shell */
  agentAsShell?: boolean;
}

/**
 * Terminal type display configuration for UI
 */
export interface TerminalTypeOption {
  type: TerminalType;
  displayName: string;
  description: string;
  icon: LucideIcon;
  /** Additional configuration options for this type */
  configOptions?: TerminalTypeConfigOption[];
}

/**
 * Configuration option for terminal type selection UI
 */
export interface TerminalTypeConfigOption {
  name: string;
  label: string;
  type: "select" | "text" | "checkbox";
  options?: { value: string; label: string }[];
  defaultValue?: string | boolean;
  required?: boolean;
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
