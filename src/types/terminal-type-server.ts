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
   * Called when creating a session of this type.
   * Returns configuration for how the session should be set up.
   *
   * Startup command precedence (applies to plugins that return a non-null
   * `shellCommand`):
   *   1. `input.startupCommandOverride` — pre-resolved by SessionService from
   *      folder preference + profile (e.g. `jclaude` wrapper). When set and
   *      compatible with the plugin's CLI, plugins should prefer it over
   *      their provider default.
   *   2. Plugin's built-in default (e.g. the agent plugin's
   *      `buildAgentCommand(provider, flags)`).
   *
   * Plugins that don't use a shell (useTmux: false) should keep returning
   * `shellCommand: null` regardless of the override.
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
