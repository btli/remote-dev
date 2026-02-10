/**
 * Session types for terminal session management
 * Pure TypeScript - no React dependencies
 */

import type { TerminalType, AgentExitState } from "./terminal-type";

export type SessionStatusType = "active" | "suspended" | "closed" | "trashed";

/**
 * Agent provider types for agent-aware sessions
 */
export type AgentProviderType = "claude" | "codex" | "gemini" | "opencode" | "none";

/**
 * Terminal session data transfer object
 * Used for API responses and state management
 */
export interface TerminalSessionDTO {
  id: string;
  userId: string;
  name: string;
  tmuxSessionName: string;
  projectPath: string | null;
  githubRepoId: string | null;
  worktreeBranch: string | null;
  folderId: string | null;
  profileId: string | null;
  terminalType: TerminalType;
  agentProvider: AgentProviderType | null;
  agentExitState: AgentExitState | null;
  agentExitCode: number | null;
  agentExitedAt: Date | null;
  agentRestartCount: number;
  typeMetadata: Record<string, unknown> | null;
  splitGroupId: string | null;
  splitOrder: number;
  splitSize: number;
  status: SessionStatusType;
  tabOrder: number;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a new session
 */
export interface CreateSessionInput {
  name: string;
  projectPath?: string;
  githubRepoId?: string;
  worktreeBranch?: string;
  folderId?: string;
  profileId?: string;
  terminalType?: TerminalType;
  agentProvider?: AgentProviderType;
  autoLaunchAgent?: boolean;
  agentFlags?: string[];
  filePath?: string;
  startupCommand?: string;
  featureDescription?: string;
  createWorktree?: boolean;
  baseBranch?: string;
}

/**
 * Input for updating an existing session
 */
export interface UpdateSessionInput {
  name?: string;
  status?: SessionStatusType;
  tabOrder?: number;
  projectPath?: string;
  profileId?: string | null;
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
  dangerousFlags?: string[];
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
    configFile: "OPENCODE.md",
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
