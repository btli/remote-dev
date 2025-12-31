/**
 * Agent-related type definitions for AI coding agent management.
 */

import type { AppearanceMode, ColorSchemeId } from "./appearance";

/**
 * Supported AI coding agent providers.
 */
export type AgentProvider = "claude" | "codex" | "gemini" | "opencode" | "all";

/**
 * Agent configuration file types.
 */
export type AgentConfigType = "CLAUDE.md" | "AGENTS.md" | "GEMINI.md" | "OPENCODE.md";

/**
 * MCP server transport types.
 */
export type MCPTransport = "stdio" | "http" | "sse";

/**
 * MCP server health status.
 */
export type MCPServerStatus = "running" | "stopped" | "error" | "starting";

/**
 * Agent profile for managing isolated agent configurations.
 */
export interface AgentProfile {
  id: string;
  userId: string;
  name: string;
  description?: string;
  provider: AgentProvider;
  configDir: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a new agent profile.
 */
export interface CreateAgentProfileInput {
  name: string;
  description?: string;
  provider: AgentProvider;
  isDefault?: boolean;
}

/**
 * Input for updating an agent profile.
 */
export interface UpdateAgentProfileInput {
  name?: string;
  description?: string;
  provider?: AgentProvider;
  isDefault?: boolean;
}

/**
 * Agent configuration stored in database.
 */
export interface AgentConfig {
  id: string;
  userId: string;
  folderId?: string;
  provider: AgentProvider;
  configType: AgentConfigType;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating/updating agent config.
 */
export interface UpsertAgentConfigInput {
  folderId?: string;
  provider: AgentProvider;
  configType: AgentConfigType;
  content: string;
}

/**
 * MCP server configuration.
 */
export interface MCPServer {
  id: string;
  userId: string;
  folderId?: string;
  name: string;
  transport: MCPTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  autoStart: boolean;
  lastHealthCheck?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating an MCP server.
 */
export interface CreateMCPServerInput {
  folderId?: string;
  name: string;
  transport: MCPTransport;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  autoStart?: boolean;
}

/**
 * Input for updating an MCP server.
 */
export interface UpdateMCPServerInput {
  name?: string;
  transport?: MCPTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  autoStart?: boolean;
}

/**
 * MCP server with runtime status.
 */
export interface MCPServerWithStatus extends MCPServer {
  status: MCPServerStatus;
  pid?: number;
  error?: string;
}

/**
 * Folder to profile link.
 */
export interface FolderProfileLink {
  folderId: string;
  profileId: string;
}

/**
 * Git identity configuration for a profile.
 */
export interface GitIdentity {
  userName: string;
  userEmail: string;
  sshKeyPath?: string;
  gpgKeyId?: string;
  githubUsername?: string;
}

/**
 * Profile credentials (stored securely).
 */
export interface ProfileCredentials {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
}

/**
 * Secrets provider type (matches SecretsProviderType from secrets module).
 */
export type ProfileSecretsProviderType = "phase" | "vault" | "aws-secrets-manager" | "1password";

/**
 * Profile-level secrets configuration.
 */
export interface ProfileSecretsConfig {
  id: string;
  profileId: string;
  userId: string;
  provider: ProfileSecretsProviderType;
  providerConfig: Record<string, string>;
  enabled: boolean;
  lastFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating/updating profile secrets config.
 */
export interface UpdateProfileSecretsConfigInput {
  provider: ProfileSecretsProviderType;
  config: Record<string, string>;
  enabled?: boolean;
}

/**
 * Profile appearance settings for per-profile theming.
 */
export interface ProfileAppearanceSettings {
  id: string;
  profileId: string;
  userId: string;
  appearanceMode: AppearanceMode;
  lightColorScheme: ColorSchemeId;
  darkColorScheme: ColorSchemeId;
  terminalOpacity: number;
  terminalBlur: number;
  terminalCursorStyle: "block" | "underline" | "bar";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for updating profile appearance settings.
 */
export interface UpdateProfileAppearanceInput {
  appearanceMode?: AppearanceMode;
  lightColorScheme?: ColorSchemeId;
  darkColorScheme?: ColorSchemeId;
  terminalOpacity?: number;
  terminalBlur?: number;
  terminalCursorStyle?: "block" | "underline" | "bar";
}

/**
 * Extended agent profile with appearance settings.
 */
export interface AgentProfileWithAppearance extends AgentProfile {
  appearance?: ProfileAppearanceSettings;
}

/**
 * Environment overlay for profile isolation.
 */
export interface ProfileEnvironment {
  HOME: string;
  XDG_CONFIG_HOME: string;
  XDG_DATA_HOME: string;
  CLAUDE_CONFIG_DIR?: string;
  CODEX_HOME?: string;
  GEMINI_HOME?: string;
  GIT_CONFIG?: string;
  GIT_SSH_COMMAND?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  [key: string]: string | undefined;
}

/**
 * MCP tool definition from server.
 */
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * MCP resource definition from server.
 */
export interface MCPResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

/**
 * Agent config template.
 */
export interface AgentConfigTemplate {
  id: string;
  name: string;
  description: string;
  provider: AgentProvider;
  configType: AgentConfigType;
  content: string;
  tags: string[];
  projectType: string; // e.g., "typescript", "python", "rust"
}

/**
 * Built-in template IDs.
 */
export const BUILT_IN_TEMPLATES = {
  TYPESCRIPT_CLAUDE: "typescript-claude",
  TYPESCRIPT_CODEX: "typescript-codex",
  TYPESCRIPT_GEMINI: "typescript-gemini",
  PYTHON_CLAUDE: "python-claude",
  PYTHON_CODEX: "python-codex",
  PYTHON_GEMINI: "python-gemini",
  RUST_CLAUDE: "rust-claude",
  REACT_CLAUDE: "react-claude",
  NEXTJS_CLAUDE: "nextjs-claude",
} as const;

/**
 * Agent provider display names.
 */
export const PROVIDER_DISPLAY_NAMES: Record<AgentProvider, string> = {
  claude: "Claude Code",
  codex: "OpenAI Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  all: "All Providers",
};

/**
 * Agent provider config file mapping.
 */
export const PROVIDER_CONFIG_FILES: Record<
  Exclude<AgentProvider, "all">,
  AgentConfigType
> = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  gemini: "GEMINI.md",
  opencode: "OPENCODE.md",
};

/**
 * Agent provider CLI commands.
 */
export const PROVIDER_CLI_COMMANDS: Record<AgentProvider, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  all: "",
};

/**
 * Agent provider config directories (relative to HOME).
 */
export const PROVIDER_CONFIG_DIRS: Record<AgentProvider, string> = {
  claude: ".claude",
  codex: ".codex",
  gemini: ".gemini",
  opencode: ".config/opencode",
  all: "",
};
