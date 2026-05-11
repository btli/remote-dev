/**
 * Terminal Type System — Server-side plugin surface
 *
 * This module declares the server-safe half of the terminal type plugin
 * interface. It intentionally avoids importing any React, Lucide, or other
 * browser-only dependencies so `session-service.ts` and other server code
 * can import plugins without dragging client modules into the server bundle.
 *
 * Companion file: `src/types/terminal-type-client.ts` for React rendering.
 *
 * @see ./terminal-type-client.ts
 * @see ./terminal-type.ts (legacy combined interface, deprecated)
 */

import type {
  TerminalType,
  SessionConfig,
  ExitBehavior,
} from "./terminal-type";
import type { TerminalSession, CreateSessionInput } from "./session";

// Re-export shared shapes so server code never has to touch the combined file.
export type {
  TerminalType,
  SessionConfig,
  ExitBehavior,
  AgentSessionMetadata,
  FileViewerMetadata,
  BrowserSessionMetadata,
  SshSessionMetadata,
  AgentExitState,
  AgentActivityStatus,
} from "./terminal-type";

/**
 * Server-side terminal type plugin.
 *
 * Responsible for session lifecycle only — creation, exit, restart, close,
 * input validation, and handler dispatch. Must not import client-only
 * modules (React, Lucide, xterm, CodeMirror, etc.).
 *
 * UI rendering lives in {@link TerminalTypeClientPlugin}.
 */
export interface TerminalTypeServerPlugin {
  /** Unique identifier for this terminal type */
  readonly type: TerminalType;

  /** Plugin priority (higher = listed first in UI). Default 0. */
  readonly priority?: number;

  /** Whether this plugin is a built-in type (cannot be unregistered) */
  readonly builtIn?: boolean;

  /**
   * Whether sessions of this type use tmux. Checked BEFORE createSession()
   * is called, so it cannot depend on runtime input. Must be static.
   *
   * Examples:
   *   - shell/agent/loop → true
   *   - file/browser/issues/prs/settings/recordings/profiles → false
   *
   * Plugins that return a `SessionConfig` from `createSession()` should set
   * `SessionConfig.useTmux` to the same value as this flag — the per-config
   * field is retained for back-compat with callers that read from the
   * returned config, but the plugin-level flag is authoritative.
   */
  readonly useTmux: boolean;

  /**
   * Whether sessions of this type should trigger the agent-style
   * exit-screen / restart flow when the tmux pane process exits.
   *
   * When true, SessionService:
   *   - registers a tmux `pane-exited` hook that POSTs to /internal/agent-exit
   *   - initializes `agentExitState = "running"` on the DB row
   *   - on exit, the client renders this plugin's exit screen and offers
   *     a Restart action
   *
   * Defaults to false. Plugins set this to true when their tmux pane
   * process is the "main task" (agent, loop, ssh) — i.e. when its exit
   * should surface a deliberate exit screen rather than silently letting
   * the user's shell hang. Only meaningful for tmux-backed plugins; safely
   * ignored on plugins where {@link useTmux} is false.
   */
  readonly emitsExitEvents?: boolean;

  /**
   * Called when creating a session of this type.
   * Returns configuration for how the session should be set up.
   *
   * For plugins that return a non-null `shellCommand`, the command is
   * derived entirely from the plugin's built-in defaults (e.g. the agent
   * plugin's `buildAgentCommand(provider, flags)`). There is no folder-
   * level string override — use shell aliases for wrappers.
   *
   * Plugins that don't use a shell (useTmux: false) should return
   * `shellCommand: null`.
   */
  createSession(
    input: CreateSessionInput,
    session: Partial<TerminalSession>
  ): Promise<SessionConfig> | SessionConfig;

  /**
   * Called when the main process exits (agent exits, shell exits, etc.).
   * Return exit behavior to control what happens next.
   */
  onSessionExit?(
    session: TerminalSession,
    exitCode: number | null
  ): ExitBehavior;

  /**
   * Called when user requests restart from exit screen.
   * Return new session config or null to prevent restart.
   */
  onSessionRestart?(
    session: TerminalSession
  ): Promise<SessionConfig | null> | SessionConfig | null;

  /**
   * Called when session is being closed/deleted.
   * Use for cleanup (delete temp files, close handles, etc.).
   */
  onSessionClose?(session: TerminalSession): Promise<void> | void;

  /**
   * Validate session creation input before creating.
   * Return an error message or null if valid.
   */
  validateInput?(input: CreateSessionInput): string | null;

  /**
   * Check if this plugin can handle a given session.
   * Used during migration and for session compatibility checks.
   */
  canHandle?(session: TerminalSession): boolean;
}
