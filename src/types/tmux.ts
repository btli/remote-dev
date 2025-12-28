/**
 * Type definitions for tmux session management API responses
 */

/**
 * A single tmux session as returned by the API.
 */
export interface TmuxSessionResponse {
  /** Tmux session name (e.g., "rdv-abc123-...") */
  name: string;
  /** Number of windows in the session */
  windowCount: number;
  /** Session creation timestamp */
  created: string; // ISO 8601
  /** Whether a client is currently attached */
  attached: boolean;
  /** Whether this session is orphaned (no DB record) */
  isOrphaned: boolean;
  /** Database session ID if tracked, null if orphaned */
  dbSessionId: string | null;
  /** Folder name if session belongs to a folder */
  folderName: string | null;
}

/**
 * Response from GET /api/tmux/sessions
 */
export interface ListTmuxSessionsResponse {
  sessions: TmuxSessionResponse[];
  totalCount: number;
  orphanedCount: number;
  trackedCount: number;
}

/**
 * Response from DELETE /api/tmux/sessions?name={name}
 */
export interface KillTmuxSessionResponse {
  success: boolean;
  sessionName: string;
}

/**
 * Response from DELETE /api/tmux/sessions/orphaned
 */
export interface KillOrphanedSessionsResponse {
  success: boolean;
  killedCount: number;
  killedSessionNames: string[];
  errors: Array<{ sessionName: string; error: string }>;
}
