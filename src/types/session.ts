/**
 * Session types for terminal session management
 */

import type { SessionType, DevServerStatus } from "./dev-server";

export type SessionStatus = "active" | "suspended" | "closed" | "trashed";

/**
 * Agent provider types for agent-aware sessions
 */
export type AgentProviderType = "claude" | "codex" | "gemini" | "opencode" | "none";

// Re-export for convenience
export type { SessionType, DevServerStatus };

export interface TerminalSession {
  id: string;
  userId: string;
  name: string;
  tmuxSessionName: string;
  projectPath: string | null;
  githubRepoId: string | null;
  worktreeBranch: string | null;
  folderId: string | null;
  // Agent profile for environment isolation
  profileId: string | null;
  // Agent-aware session fields
  agentProvider: AgentProviderType | null;
  // Split group membership (independent from folder)
  splitGroupId: string | null;
  splitOrder: number;
  splitSize: number;
  // Session type: terminal (default) or dev-server
  sessionType: SessionType;
  // Dev server fields (only set when sessionType === "dev-server")
  devServerPort: number | null;
  devServerStatus: DevServerStatus | null;
  devServerUrl: string | null;
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
  folderId?: string;
  // Agent profile for environment isolation
  profileId?: string;
  // Agent-aware session fields
  agentProvider?: AgentProviderType;  // Which AI agent to use
  autoLaunchAgent?: boolean;          // Whether to auto-launch the agent CLI
  agentFlags?: string[];              // Additional flags for the agent CLI
  // Feature session fields
  startupCommand?: string;      // Override resolved preferences
  featureDescription?: string;  // Original feature description
  createWorktree?: boolean;     // Whether to create worktree
  baseBranch?: string;          // Base branch for new worktree
  // Dev server session fields
  sessionType?: SessionType;    // "terminal" (default) or "dev-server"
  devServerPort?: number;       // Port for dev server (when sessionType === "dev-server")
}

/**
 * Agent provider configuration
 */
export interface AgentProviderConfig {
  id: AgentProviderType;
  name: string;
  description: string;
  command: string;
  configFile: string;
  defaultFlags: string[];
  dangerousFlags?: string[];  // Flags that skip safety checks
}

/**
 * Available agent providers with their configurations
 */
export const AGENT_PROVIDERS: AgentProviderConfig[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "Anthropic's AI coding assistant with full terminal access",
    command: "claude",
    configFile: "CLAUDE.md",
    defaultFlags: [],
    dangerousFlags: ["--dangerously-skip-permissions"],
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    description: "OpenAI's code-focused AI assistant",
    command: "codex",
    configFile: "AGENTS.md",
    defaultFlags: [],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google's Gemini AI for code assistance",
    command: "gemini",
    configFile: "GEMINI.md",
    defaultFlags: [],
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "Multi-provider AI coding assistant",
    command: "opencode",
    configFile: "",
    defaultFlags: [],
  },
  {
    id: "none",
    name: "No Agent",
    description: "Standard terminal session without AI agent",
    command: "",
    configFile: "",
    defaultFlags: [],
  },
];

// AI Agent presets for feature sessions
export type AgentPreset = "claude" | "clauded" | "gemini" | "geminy" | "custom";

export interface AgentConfig {
  id: AgentPreset;
  label: string;
  command: string;
  description: string;
}

export const AGENT_PRESETS: AgentConfig[] = [
  { id: "claude", label: "Claude", command: "claude", description: "Claude Code AI assistant" },
  { id: "clauded", label: "Claude (Daemon)", command: "clauded", description: "Claude daemon mode" },
  { id: "gemini", label: "Gemini", command: "gemini", description: "Google Gemini AI" },
  { id: "geminy", label: "Geminy", command: "geminy", description: "Gemini daemon mode" },
  { id: "custom", label: "Custom", command: "", description: "Enter custom command" },
];

export interface UpdateSessionInput {
  name?: string;
  status?: SessionStatus;
  tabOrder?: number;
  projectPath?: string;
  profileId?: string | null;
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
