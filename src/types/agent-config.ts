/**
 * Agent JSON Configuration Types
 *
 * Defines the structure of configuration objects for each AI coding agent CLI.
 * These correspond to the settings documented in:
 * - Claude Code: https://code.claude.com/docs/en/settings
 * - Gemini CLI: https://geminicli.com/docs/get-started/configuration
 * - OpenCode: https://opencode.ai/docs/config
 * - Codex CLI: https://developers.openai.com/codex/config-basic
 */

import type { AgentProvider } from "./agent";

// =============================================================================
// Claude Code Configuration
// =============================================================================

export interface ClaudeCodePermissions {
  allow?: string[];
  ask?: string[];
  deny?: string[];
  additionalDirectories?: string[];
  defaultMode?: "acceptEdits" | "askOnEdit" | "readOnly";
  disableBypassPermissionsMode?: boolean;
}

export interface ClaudeCodeSandboxNetwork {
  allowUnixSockets?: string[];
  allowLocalBinding?: boolean;
  httpProxyPort?: number;
  socksProxyPort?: number;
}

export interface ClaudeCodeSandbox {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  excludedCommands?: string[];
  allowUnsandboxedCommands?: boolean;
  network?: ClaudeCodeSandboxNetwork;
}

export interface ClaudeCodeHook {
  matcher?: string;
  command?: string;
  timeout?: number;
}

export interface ClaudeCodeHooks {
  PreToolUse?: ClaudeCodeHook[];
  PostToolUse?: ClaudeCodeHook[];
  disableAllHooks?: boolean;
}

export interface ClaudeCodeAttribution {
  commit?: string;
  pr?: string;
  includeCoAuthoredBy?: boolean;
}

export interface ClaudeCodeStatusLine {
  type?: "disabled" | "command";
  command?: string;
}

export interface ClaudeCodeMCPServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ClaudeCodeOutput {
  verbose?: boolean;
  notifications?: boolean;
  colors?: boolean;
}

export interface ClaudeCodeConfig {
  model?: string;
  cleanupPeriodDays?: number;
  env?: Record<string, string>;
  permissions?: ClaudeCodePermissions;
  sandbox?: ClaudeCodeSandbox;
  hooks?: ClaudeCodeHooks;
  attribution?: ClaudeCodeAttribution;
  statusLine?: ClaudeCodeStatusLine;
  mcpServers?: Record<string, ClaudeCodeMCPServer>;
  output?: ClaudeCodeOutput;
}

// =============================================================================
// Gemini CLI Configuration
// =============================================================================

export interface GeminiSessionRetention {
  enabled?: boolean;
  maxAge?: number; // Days
  maxCount?: number;
}

export interface GeminiCustomTheme {
  name: string;
  primary?: string;
  secondary?: string;
  background?: string;
  foreground?: string;
}

export interface GeminiUISettings {
  theme?: string;
  customThemes?: GeminiCustomTheme[];
  showFooter?: boolean;
  compactMode?: boolean;
  accessibility?: {
    highContrast?: boolean;
    reducedMotion?: boolean;
  };
}

export interface GeminiModelSettings {
  name?: string;
  maxSessionTurns?: number;
  compressionThreshold?: number;
}

export interface GeminiContextSettings {
  historyLimit?: number;
  fileLimit?: number;
  searchEnabled?: boolean;
}

export interface GeminiToolSandbox {
  enabled?: boolean;
  mode?: "strict" | "permissive";
}

export interface GeminiToolShell {
  allowedCommands?: string[];
  blockedCommands?: string[];
}

export interface GeminiCoreTools {
  webSearch?: boolean;
  googleMaps?: boolean;
  youtube?: boolean;
  codeExecution?: boolean;
}

export interface GeminiToolSettings {
  sandbox?: GeminiToolSandbox;
  shell?: GeminiToolShell;
  autoAccept?: {
    patterns?: string[];
  };
  coreTools?: GeminiCoreTools;
}

export interface GeminiSecuritySettings {
  disableYoloMode?: boolean;
  environmentVariableRedaction?: {
    enabled?: boolean;
    patterns?: string[];
  };
}

export interface GeminiHook {
  command?: string;
  timeout?: number;
}

export interface GeminiHooks {
  BeforeTool?: GeminiHook[];
  AfterTool?: GeminiHook[];
  SessionStart?: GeminiHook[];
  SessionEnd?: GeminiHook[];
  Error?: GeminiHook[];
}

export interface GeminiMCPServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  autoConnect?: boolean;
}

export interface GeminiExperimentalFeatures {
  [key: string]: boolean;
}

export interface GeminiCLIConfig {
  previewFeatures?: boolean;
  vimMode?: boolean;
  disableAutoUpdate?: boolean;
  sessionRetention?: GeminiSessionRetention;
  ui?: GeminiUISettings;
  model?: GeminiModelSettings;
  context?: GeminiContextSettings;
  tools?: GeminiToolSettings;
  security?: GeminiSecuritySettings;
  hooks?: GeminiHooks;
  mcpServers?: Record<string, GeminiMCPServer>;
  experimental?: GeminiExperimentalFeatures;
}

// =============================================================================
// OpenCode Configuration
// =============================================================================

export interface OpenCodeModels {
  model?: string;
  smallModel?: string;
  disabledProviders?: string[];
}

export interface OpenCodeInterface {
  theme?: string;
  tuiScroll?: boolean;
  diffStyle?: "unified" | "split";
}

export interface OpenCodeServer {
  listen?: string;
  previewEnabled?: boolean;
  previewPort?: number;
}

export interface OpenCodeTools {
  write?: boolean;
  bash?: boolean;
  permissionMode?: "ask" | "auto" | "deny";
}

export interface OpenCodeAgent {
  name: string;
  model?: string;
  systemPrompt?: string;
}

export interface OpenCodeCommand {
  name: string;
  command: string;
  description?: string;
}

export interface OpenCodeCodeQuality {
  autoLint?: boolean;
  smartFormat?: boolean;
  formatOnSave?: boolean;
}

export interface OpenCodeContext {
  compaction?: {
    enabled?: boolean;
    threshold?: number;
  };
  watcher?: {
    enabled?: boolean;
    patterns?: string[];
  };
}

export interface OpenCodeConfig {
  models?: OpenCodeModels;
  interface?: OpenCodeInterface;
  server?: OpenCodeServer;
  tools?: OpenCodeTools;
  agents?: OpenCodeAgent[];
  commands?: OpenCodeCommand[];
  codeQuality?: OpenCodeCodeQuality;
  context?: OpenCodeContext;
}

// =============================================================================
// Codex CLI Configuration
// =============================================================================

export interface CodexModelSettings {
  model?: string;
  provider?: string;
  reasoningEffort?: "low" | "medium" | "high";
  verbosity?: "quiet" | "normal" | "verbose";
}

export interface CodexExecutionEnvironment {
  approvalPolicy?: "suggest" | "auto-edit" | "full-auto";
  sandboxMode?: "docker" | "none" | "seatbelt";
}

export interface CodexFeatureFlags {
  unifiedExec?: boolean;
  skills?: boolean;
  tui2?: boolean;
}

export interface CodexModelProvider {
  name: string;
  baseUrl?: string;
  apiKey?: string; // Reference to env var
}

export interface CodexMCPServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface CodexObservability {
  loggingEnabled?: boolean;
  logLevel?: "debug" | "info" | "warn" | "error";
  metricsEnabled?: boolean;
}

export interface CodexCLIConfig {
  model?: CodexModelSettings;
  execution?: CodexExecutionEnvironment;
  features?: CodexFeatureFlags;
  providers?: CodexModelProvider[];
  mcpServers?: Record<string, CodexMCPServer>;
  observability?: CodexObservability;
}

// =============================================================================
// Union Type and Type Guards
// =============================================================================

export type AgentJsonConfig =
  | ClaudeCodeConfig
  | GeminiCLIConfig
  | OpenCodeConfig
  | CodexCLIConfig;

export type AgentConfigType = Exclude<AgentProvider, "all">;

export interface AgentProfileJsonConfig {
  id: string;
  profileId: string;
  userId: string;
  agentType: AgentConfigType;
  configJson: AgentJsonConfig;
  isValid: boolean;
  validationErrors?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentProfileJsonConfigInput {
  profileId: string;
  agentType: AgentConfigType;
  configJson: AgentJsonConfig;
}

export interface UpdateAgentProfileJsonConfigInput {
  configJson: Partial<AgentJsonConfig>;
}

// Type guards for config types
export function isClaudeCodeConfig(
  config: AgentJsonConfig,
  agentType: AgentConfigType
): config is ClaudeCodeConfig {
  return agentType === "claude";
}

export function isGeminiCLIConfig(
  config: AgentJsonConfig,
  agentType: AgentConfigType
): config is GeminiCLIConfig {
  return agentType === "gemini";
}

export function isOpenCodeConfig(
  config: AgentJsonConfig,
  agentType: AgentConfigType
): config is OpenCodeConfig {
  return agentType === "opencode";
}

export function isCodexCLIConfig(
  config: AgentJsonConfig,
  agentType: AgentConfigType
): config is CodexCLIConfig {
  return agentType === "codex";
}

// Default configurations for each agent type
export const DEFAULT_CLAUDE_CODE_CONFIG: ClaudeCodeConfig = {
  model: "claude-sonnet-4",
  cleanupPeriodDays: 30,
  permissions: {
    defaultMode: "askOnEdit",
  },
  sandbox: {
    enabled: false,
  },
  output: {
    verbose: false,
    notifications: true,
    colors: true,
  },
};

export const DEFAULT_GEMINI_CLI_CONFIG: GeminiCLIConfig = {
  previewFeatures: false,
  vimMode: false,
  disableAutoUpdate: false,
  sessionRetention: {
    enabled: true,
    maxAge: 7,
    maxCount: 50,
  },
  ui: {
    theme: "default",
    showFooter: true,
    compactMode: false,
  },
  model: {
    name: "gemini-2.0-flash",
    maxSessionTurns: 100,
  },
  tools: {
    sandbox: {
      enabled: true,
      mode: "permissive",
    },
    coreTools: {
      webSearch: true,
      codeExecution: true,
    },
  },
  security: {
    disableYoloMode: true,
  },
};

export const DEFAULT_OPENCODE_CONFIG: OpenCodeConfig = {
  models: {
    model: "gpt-4o",
  },
  interface: {
    theme: "default",
    tuiScroll: true,
    diffStyle: "unified",
  },
  tools: {
    write: true,
    bash: true,
    permissionMode: "ask",
  },
  codeQuality: {
    autoLint: true,
    smartFormat: true,
    formatOnSave: true,
  },
};

export const DEFAULT_CODEX_CLI_CONFIG: CodexCLIConfig = {
  model: {
    model: "codex-mini-latest",
    reasoningEffort: "medium",
    verbosity: "normal",
  },
  execution: {
    approvalPolicy: "suggest",
    sandboxMode: "seatbelt",
  },
  features: {
    unifiedExec: true,
    skills: true,
    tui2: false,
  },
  observability: {
    loggingEnabled: false,
    logLevel: "info",
  },
};

export function getDefaultConfig(agentType: AgentConfigType): AgentJsonConfig {
  switch (agentType) {
    case "claude":
      return DEFAULT_CLAUDE_CODE_CONFIG;
    case "gemini":
      return DEFAULT_GEMINI_CLI_CONFIG;
    case "opencode":
      return DEFAULT_OPENCODE_CONFIG;
    case "codex":
      return DEFAULT_CODEX_CLI_CONFIG;
  }
}
