/**
 * Session types for terminal session management
 */

import type { TerminalType, AgentExitState } from "./terminal-type";

export type SessionStatus = "active" | "suspended" | "closed" | "trashed";

/**
 * Agent provider types for agent-aware sessions
 */
export type AgentProviderType =
  | "claude"
  | "codex"
  | "gemini"
  | "antigravity"
  | "opencode"
  | "cursor"
  | "kimi"
  | "none";

/**
 * Worktree type determines the branch name prefix (e.g., feature/, fix/, chore/)
 */
export type WorktreeType = "feature" | "fix" | "chore" | "refactor" | "docs" | "release";

export const WORKTREE_TYPES: { id: WorktreeType; label: string }[] = [
  { id: "feature", label: "feature" },
  { id: "fix", label: "fix" },
  { id: "chore", label: "chore" },
  { id: "refactor", label: "refactor" },
  { id: "docs", label: "docs" },
  { id: "release", label: "release" },
];

export interface TerminalSession {
  id: string;
  userId: string;
  name: string;
  tmuxSessionName: string;
  projectPath: string | null;
  githubRepoId: string | null;
  worktreeBranch: string | null;
  worktreeType: WorktreeType | null;
  projectId: string | null;
  // Agent profile for environment isolation
  profileId: string | null;
  /**
   * The Claude account this session launched under (whose
   * `CLAUDE_CODE_OAUTH_TOKEN` was injected). Independent of `profileId`.
   * [remote-dev-n4x4.6]
   */
  claudeAccountId: string | null;
  // Terminal type: shell, agent, file, or custom
  terminalType: TerminalType;
  // Agent-aware session fields
  agentProvider: AgentProviderType | null;
  // Agent session state (for agent terminal type)
  agentExitState: AgentExitState | null;
  agentExitCode: number | null;
  agentExitedAt: Date | null;
  agentRestartCount: number;
  // Real-time agent activity status (persisted for page reload)
  agentActivityStatus: string | null;
  // [remote-dev-1aa5] Server-arrival epoch ms of the latest activity-status
  // write. Lets the client re-seed (refreshSessions) compare DB-row freshness
  // against the live cache so a stale push can't shadow a newer DB truth.
  agentActivityStatusAt: number | null;
  // Plugin-specific metadata (parsed from JSON)
  typeMetadata: Record<string, unknown> | null;
  // Scope key for server-side deduplication. See CreateSessionInput.scopeKey.
  scopeKey: string | null;
  // Parent session for team orchestration
  parentSessionId: string | null;
  status: SessionStatus;
  pinned: boolean;
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
  /**
   * Required at the service/API layer: terminal_session.project_id is NOT NULL
   * (Phase G0a). UI callers should use ClientCreateSessionInput, which allows
   * omitting projectId; the SessionContext then resolves it from the active
   * node before POSTing to the API.
   */
  projectId: string;
  // Agent profile for environment isolation
  profileId?: string;
  /**
   * Pin the Claude account to run as (overrides primary→pool selection).
   * [remote-dev-n4x4.6]
   */
  claudeAccountId?: string | null;
  // Terminal type: shell, agent, file (default: determined by agentProvider)
  terminalType?: TerminalType;
  // Agent-aware session fields
  agentProvider?: AgentProviderType;  // Which AI agent to use
  autoLaunchAgent?: boolean;          // Whether to auto-launch the agent CLI
  agentFlags?: string[];              // Additional flags for the agent CLI
  /** Override the plugin-level allowDangerousFlags for this session. */
  allowDangerousFlags?: boolean;
  // For file terminal type
  // NOTE: legacy convenience field retained for back-compat. New callers
  // should pass `typeMetadata: { filePath, fileName }` directly instead.
  filePath?: string;                  // Path to file being edited
  /**
   * Optional plugin-specific metadata to merge into the new session's
   * typeMetadata JSON. Takes precedence over plugin-provided defaults on
   * key conflicts.
   */
  typeMetadata?: Record<string, unknown>;
  /**
   * Optional scope key for server-side deduplication. When set, the
   * service will return an existing open session matching
   * (userId, terminalType, scopeKey) instead of creating a new row.
   */
  scopeKey?: string | null;
  /**
   * Initial detached tmux window geometry (`new-session -x/-y`); both must be
   * set to take effect. Without them a detached session is 80×24 until a
   * client attaches. Used by the Claude setup-token flow to keep the ~108-char
   * token from being clipped at the pane edge [remote-dev-307w]. Best-effort:
   * an attaching client may resize the window to its own viewport afterwards.
   */
  initialCols?: number;
  initialRows?: number;
  // Parent session for team orchestration
  parentSessionId?: string;
  // Feature session fields
  featureDescription?: string;  // Original feature description
  createWorktree?: boolean;     // Whether to create worktree
  baseBranch?: string;          // Base branch for new worktree
  worktreeType?: WorktreeType;  // Branch prefix type (feature, fix, etc.)
  // Loop agent session fields
  loopConfig?: import("./loop-agent").LoopConfig;
  // SSH session fields — the connection record holds host/credentials/options
  sshConnectionId?: string;
}

/**
 * Client-facing session input: projectId is optional here because the
 * SessionContext derives it from the active project node when not provided.
 * The context validates a resolved projectId before calling the API.
 */
export type ClientCreateSessionInput = Omit<CreateSessionInput, "projectId"> & {
  projectId?: string | null;
};

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
    id: "antigravity",
    name: "Antigravity CLI",
    description: "Google's next-generation AI coding agent (successor to Gemini CLI)",
    command: "agy",
    configFile: "ANTIGRAVITY.md",
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
    id: "cursor",
    name: "Cursor",
    description: "Cursor's interactive AI coding agent",
    command: "agent",
    configFile: "AGENTS.md",
    defaultFlags: [],
    dangerousFlags: ["-f", "--force", "--yolo"],
  },
  {
    id: "kimi",
    name: "Kimi",
    description: "Moonshot AI's Kimi Code CLI agent",
    command: "kimi",
    configFile: "AGENTS.md",
    defaultFlags: [],
    dangerousFlags: ["-y", "--yolo", "--yes", "--auto-approve", "--auto"],
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
export type AgentPreset =
  | "claude"
  | "clauded"
  | "gemini"
  | "geminy"
  | "antigravity"
  | "cursor"
  | "kimi"
  | "custom";

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
  { id: "antigravity", label: "Antigravity", command: "agy", description: "Antigravity AI coding agent" },
  { id: "cursor", label: "Cursor", command: "agent", description: "Cursor AI coding agent" },
  { id: "kimi", label: "Kimi", command: "kimi", description: "Kimi Code CLI agent" },
  { id: "custom", label: "Custom", command: "", description: "Enter custom command" },
];

/** Providers offered by the chat-first loop-session UI. */
export const LOOP_AGENT_PROVIDERS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "kimi",
] as const satisfies readonly Exclude<AgentProviderType, "none" | "antigravity">[];

export interface UpdateSessionInput {
  name?: string;
  status?: SessionStatus;
  pinned?: boolean;
  tabOrder?: number;
  projectPath?: string;
  profileId?: string | null;
  /** Shallow-merged into existing typeMetadata JSON. Set a key to null to delete it. */
  typeMetadataPatch?: Record<string, unknown>;
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
