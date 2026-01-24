/**
 * TmuxGateway - Port interface for tmux operations.
 *
 * This interface abstracts tmux session management, allowing the application
 * layer to orchestrate sessions without knowing implementation details.
 */

import type { TmuxEnvironment } from "@/domain/value-objects/TmuxEnvironment";

export interface TmuxSessionInfo {
  name: string;
  /** Session creation time (may not be available from all implementations) */
  created?: Date;
  /** Whether clients are attached (may not be available from all implementations) */
  attached?: boolean;
  /** Number of windows (may not be available from all implementations) */
  windows?: number;
}

export interface CreateTmuxSessionOptions {
  sessionName: string;
  workingDirectory?: string;
  startupCommand?: string;
  environment?: Record<string, string>;
}

/**
 * Tmux hook definition.
 * Hooks run commands when certain events occur in tmux.
 */
export interface TmuxHook {
  /**
   * Hook trigger event:
   * - 'pane-exited': When a pane's command exits (shell, agent, etc.)
   * - 'session-closed': When the session is destroyed
   * - 'client-attached': When a client attaches to the session
   * - 'client-detached': When a client detaches from the session
   * - 'window-linked': When a window is linked to the session
   */
  name:
    | "pane-exited"
    | "session-closed"
    | "client-attached"
    | "client-detached"
    | "window-linked";
  /**
   * Shell command to run when the hook triggers.
   * Can use tmux variables like #{session_name}, #{pane_id}, etc.
   */
  command: string;
}

export interface TmuxGateway {
  /**
   * Create a new tmux session.
   */
  createSession(options: CreateTmuxSessionOptions): Promise<void>;

  /**
   * Kill (terminate) a tmux session.
   */
  killSession(sessionName: string): Promise<void>;

  /**
   * Check if a tmux session exists.
   */
  sessionExists(sessionName: string): Promise<boolean>;

  /**
   * Get information about a tmux session.
   */
  getSessionInfo(sessionName: string): Promise<TmuxSessionInfo | null>;

  /**
   * List all tmux sessions on the system.
   */
  listSessions(): Promise<TmuxSessionInfo[]>;

  /**
   * Send keys to a tmux session.
   */
  sendKeys(sessionName: string, keys: string): Promise<void>;

  /**
   * Detach all clients from a tmux session.
   */
  detachSession(sessionName: string): Promise<void>;

  /**
   * Generate a unique tmux session name for a session ID.
   */
  generateSessionName(sessionId: string): string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Environment Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set environment variables at the tmux session level.
   *
   * These variables persist across shell exits and are inherited by all
   * processes spawned in the session. Uses `tmux set-environment`.
   *
   * @param sessionName - Name of the tmux session
   * @param vars - Environment variables to set
   */
  setEnvironment(sessionName: string, vars: TmuxEnvironment): Promise<void>;

  /**
   * Get environment variables from a tmux session.
   *
   * @param sessionName - Name of the tmux session
   * @returns The session's environment variables
   */
  getEnvironment(sessionName: string): Promise<TmuxEnvironment>;

  /**
   * Unset (remove) environment variables from a tmux session.
   *
   * @param sessionName - Name of the tmux session
   * @param keys - Environment variable names to unset
   */
  unsetEnvironment(sessionName: string, keys: string[]): Promise<void>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Hooks Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set a hook on a tmux session.
   *
   * Hooks run commands when certain events occur. If a hook with the same
   * name already exists, it will be replaced.
   *
   * @param sessionName - Name of the tmux session
   * @param hook - Hook definition
   */
  setHook(sessionName: string, hook: TmuxHook): Promise<void>;

  /**
   * Remove a hook from a tmux session.
   *
   * @param sessionName - Name of the tmux session
   * @param hookName - Name of the hook to remove
   */
  removeHook(sessionName: string, hookName: string): Promise<void>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Options Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set a tmux session option.
   *
   * Common options:
   * - 'mouse': 'on' or 'off' - Enable/disable mouse support
   * - 'history-limit': Number as string - Scrollback buffer size
   * - 'remain-on-exit': 'on' or 'off' - Keep pane after process exits
   * - 'status': 'on' or 'off' - Show/hide status bar
   *
   * @param sessionName - Name of the tmux session
   * @param option - Option name
   * @param value - Option value
   */
  setOption(sessionName: string, option: string, value: string): Promise<void>;

  /**
   * Get a tmux session option value.
   *
   * @param sessionName - Name of the tmux session
   * @param option - Option name
   * @returns The option value, or null if not set
   */
  getOption(sessionName: string, option: string): Promise<string | null>;
}
