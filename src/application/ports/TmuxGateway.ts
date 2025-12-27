/**
 * TmuxGateway - Port interface for tmux operations.
 *
 * This interface abstracts tmux session management, allowing the application
 * layer to orchestrate sessions without knowing implementation details.
 */

export interface TmuxSessionInfo {
  name: string;
  created: Date;
  attached: boolean;
  windows: number;
}

export interface CreateTmuxSessionOptions {
  sessionName: string;
  workingDirectory?: string;
  startupCommand?: string;
  environment?: Record<string, string>;
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
}
