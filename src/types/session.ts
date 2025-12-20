/**
 * Session types for terminal session management
 */

export type SessionStatus = "active" | "suspended" | "closed";

export interface TerminalSession {
  id: string;
  userId: string;
  name: string;
  tmuxSessionName: string;
  projectPath: string | null;
  githubRepoId: string | null;
  worktreeBranch: string | null;
  status: SessionStatus;
  tabOrder: number;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionInput {
  name: string;
  projectPath?: string;
  githubRepoId?: string;
  worktreeBranch?: string;
}

export interface UpdateSessionInput {
  name?: string;
  status?: SessionStatus;
  tabOrder?: number;
  projectPath?: string;
}

export interface SessionWithMetadata extends TerminalSession {
  repository?: {
    id: string;
    name: string;
    fullName: string;
    cloneUrl: string;
  } | null;
}

// State management types
export type SessionAction =
  | { type: "LOAD_SESSIONS"; sessions: TerminalSession[] }
  | { type: "CREATE"; session: TerminalSession }
  | { type: "UPDATE"; sessionId: string; updates: Partial<TerminalSession> }
  | { type: "DELETE"; sessionId: string }
  | { type: "SET_ACTIVE"; sessionId: string | null }
  | { type: "REORDER"; sessionIds: string[] };

export interface SessionState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  loading: boolean;
  error: Error | null;
}
