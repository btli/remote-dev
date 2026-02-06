/**
 * Agent MCP Configuration Types
 *
 * Types for MCP server configurations parsed from different agent CLI config files.
 * Each agent stores MCP configs differently:
 * - Claude Code: .mcp.json or ~/.claude.json (JSON with mcpServers)
 * - Gemini CLI: .gemini/settings.json (JSON with mcpServers)
 * - Codex CLI: .codex/config.toml (TOML with [mcp_servers.<name>])
 * - OpenCode: No MCP support
 */

import type { AgentProviderType } from "./session";
import type { MCPTransport } from "./agent";

/**
 * Parsed MCP server from agent config file.
 * Normalized structure regardless of source agent.
 */
export interface ParsedMCPServer {
  /** Server name (key in config) */
  name: string;
  /** Transport type */
  transport: MCPTransport;
  /** Command to start server (for stdio) or URL (for http/sse) */
  command: string;
  /** Command arguments */
  args: string[];
  /** Environment variables */
  env: Record<string, string>;
  /** Whether server is enabled (default true) */
  enabled: boolean;
  /** Source file path where this config was found */
  sourceFile: string;
  /** Which agent this config is for */
  agentProvider: AgentProviderType;
}

/**
 * Result of parsing MCP configs for a session.
 */
export interface SessionMCPConfig {
  /** Session ID */
  sessionId: string;
  /** Agent provider type */
  agentProvider: AgentProviderType;
  /** Project path where configs were read from */
  projectPath: string;
  /** Parsed MCP servers */
  servers: ParsedMCPServer[];
  /** Whether MCP is supported by this agent */
  mcpSupported: boolean;
  /** Error message if parsing failed */
  error?: string;
  /** Config files that were checked */
  configFilesChecked: string[];
  /** Config files that exist */
  configFilesFound: string[];
  /** Timestamp of when config was parsed */
  parsedAt: Date;
}

/**
 * MCP server with discovered tools and resources.
 */
export interface MCPServerWithDiscovery extends ParsedMCPServer {
  /** Discovered tools (if discovery was run) */
  tools?: MCPDiscoveredTool[];
  /** Discovered resources (if discovery was run) */
  resources?: MCPDiscoveredResource[];
  /** Discovery status */
  discoveryStatus: "pending" | "running" | "completed" | "error";
  /** Discovery error message */
  discoveryError?: string;
  /** When discovery was last run */
  lastDiscoveryAt?: Date;
}

/**
 * Discovered MCP tool.
 */
export interface MCPDiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Discovered MCP resource.
 */
export interface MCPDiscoveredResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

/**
 * API response for session MCP servers.
 */
export interface SessionMCPServersResponse {
  sessionId: string;
  agentProvider: AgentProviderType | null;
  projectPath: string | null;
  mcpSupported: boolean;
  servers: ParsedMCPServer[];
  configFilesChecked: string[];
  configFilesFound: string[];
  error?: string;
}

/**
 * Input for updating an MCP server in config file.
 */
export interface UpdateMCPServerConfigInput {
  /** Server name to update */
  name: string;
  /** New enabled state */
  enabled?: boolean;
  /** New command */
  command?: string;
  /** New args */
  args?: string[];
  /** New env */
  env?: Record<string, string>;
}

/**
 * Discovery status for session-scoped MCP discovery.
 */
export type SessionDiscoveryStatus =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "timeout";

/**
 * Session-scoped discovery result (not persisted to database).
 * Used for in-memory caching in SessionMCPContext.
 */
export interface SessionServerDiscoveryResult {
  /** Server name from config */
  serverName: string;
  /** Source file where server was defined */
  sourceFile: string;
  /** Discovered tools */
  tools: MCPDiscoveredTool[];
  /** Discovered resources */
  resources: MCPDiscoveredResource[];
  /** Discovery status */
  discoveryStatus: SessionDiscoveryStatus;
  /** Error message if discovery failed */
  error?: string;
  /** When discovery completed */
  discoveredAt: Date;
}

/**
 * API response for session MCP discovery.
 */
export interface SessionMCPDiscoveryResponse {
  /** Single server result or array of results */
  results: SessionServerDiscoveryResult | SessionServerDiscoveryResult[];
}
