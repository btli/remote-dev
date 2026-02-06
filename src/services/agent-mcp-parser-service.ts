/**
 * Agent MCP Parser Service
 *
 * Parses MCP server configurations from different agent CLI config files.
 * Each agent stores configs differently:
 * - Claude Code: .mcp.json (project) or ~/.claude.json (global)
 * - Gemini CLI: .gemini/settings.json (project) or ~/.gemini/settings.json (global)
 * - Codex CLI: .codex/config.toml (project) or ~/.codex/config.toml (global)
 * - OpenCode: No MCP support
 */

import { readFile, access, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { AgentProviderType } from "@/types/session";
import type {
  ParsedMCPServer,
  SessionMCPConfig,
  UpdateMCPServerConfigInput,
} from "@/types/agent-mcp";
import type { MCPTransport } from "@/types/agent";

/**
 * Get MCP config file paths to check for an agent provider.
 */
function getConfigPaths(
  agentProvider: AgentProviderType,
  projectPath: string
): string[] {
  const home = homedir();

  switch (agentProvider) {
    case "claude":
      return [
        join(projectPath, ".mcp.json"), // Project-level
        join(projectPath, ".claude", "settings.json"), // Project .claude dir
        join(home, ".claude.json"), // Global
        join(home, ".claude", "settings.json"), // Global .claude dir
      ];
    case "gemini":
      return [
        join(projectPath, ".gemini", "settings.json"), // Project-level
        join(home, ".gemini", "settings.json"), // Global
      ];
    case "codex":
      return [
        join(projectPath, ".codex", "config.toml"), // Project-level
        join(home, ".codex", "config.toml"), // Global
      ];
    case "opencode":
    case "none":
      return []; // No MCP support
    default:
      return [];
  }
}

/**
 * Check if a file exists.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse Claude Code MCP config (JSON format).
 * Supports both .mcp.json and settings.json formats.
 */
async function parseClaudeConfig(
  filePath: string
): Promise<ParsedMCPServer[]> {
  const content = await readFile(filePath, "utf-8");
  const config = JSON.parse(content);

  // mcpServers can be at root level (.mcp.json) or nested (settings.json)
  const mcpServers = config.mcpServers || {};
  const servers: ParsedMCPServer[] = [];

  for (const [name, serverConfig] of Object.entries(mcpServers)) {
    const server = serverConfig as {
      command?: string;
      url?: string;
      args?: string[];
      env?: Record<string, string>;
      disabled?: boolean;
    };

    // Determine transport type
    let transport: MCPTransport = "stdio";
    let command = server.command || "";

    if (server.url) {
      transport = server.url.includes("/sse") ? "sse" : "http";
      command = server.url;
    }

    servers.push({
      name,
      transport,
      command,
      args: server.args || [],
      env: server.env || {},
      enabled: !server.disabled,
      sourceFile: filePath,
      agentProvider: "claude",
    });
  }

  return servers;
}

/**
 * Parse Gemini CLI MCP config (JSON format).
 */
async function parseGeminiConfig(
  filePath: string
): Promise<ParsedMCPServer[]> {
  const content = await readFile(filePath, "utf-8");
  const config = JSON.parse(content);

  const mcpServers = config.mcpServers || {};
  const servers: ParsedMCPServer[] = [];

  for (const [name, serverConfig] of Object.entries(mcpServers)) {
    const server = serverConfig as {
      command?: string;
      url?: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
      timeout?: number;
      trust?: boolean;
      disabled?: boolean;
    };

    // Determine transport type
    let transport: MCPTransport = "stdio";
    let command = server.command || "";

    if (server.url) {
      transport = server.url.includes("/sse") ? "sse" : "http";
      command = server.url;
    }

    servers.push({
      name,
      transport,
      command,
      args: server.args || [],
      env: server.env || {},
      enabled: !server.disabled,
      sourceFile: filePath,
      agentProvider: "gemini",
    });
  }

  return servers;
}

/**
 * Parse Codex CLI MCP config (TOML format).
 * Simple parser for the specific [mcp_servers.<name>] format.
 */
async function parseCodexConfig(
  filePath: string
): Promise<ParsedMCPServer[]> {
  const content = await readFile(filePath, "utf-8");
  const servers: ParsedMCPServer[] = [];

  // Match [mcp_servers.<name>] sections
  const sectionRegex = /\[mcp_servers\.([^\]]+)\]/g;
  const sections: { name: string; startIdx: number }[] = [];

  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    sections.push({ name: match[1], startIdx: match.index + match[0].length });
  }

  // Parse each section
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const endIdx = i + 1 < sections.length
      ? content.indexOf("[", sections[i + 1].startIdx - 50) // Find next section
      : content.length;

    const sectionContent = content.slice(section.startIdx, endIdx);

    // Parse key-value pairs
    const command = parseTomlString(sectionContent, "command") || "";
    const args = parseTomlArray(sectionContent, "args") || [];
    const env = parseTomlInlineTable(sectionContent, "env") || {};
    const disabled = parseTomlBoolean(sectionContent, "disabled") || false;
    const url = parseTomlString(sectionContent, "url");

    // Determine transport
    let transport: MCPTransport = "stdio";
    let finalCommand = command;

    if (url) {
      transport = url.includes("/sse") ? "sse" : "http";
      finalCommand = url;
    }

    servers.push({
      name: section.name,
      transport,
      command: finalCommand,
      args,
      env,
      enabled: !disabled,
      sourceFile: filePath,
      agentProvider: "codex",
    });
  }

  return servers;
}

/**
 * Parse a TOML string value.
 */
function parseTomlString(content: string, key: string): string | undefined {
  const regex = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m");
  const match = content.match(regex);
  return match ? match[1] : undefined;
}

/**
 * Parse a TOML boolean value.
 */
function parseTomlBoolean(content: string, key: string): boolean | undefined {
  const regex = new RegExp(`^${key}\\s*=\\s*(true|false)`, "m");
  const match = content.match(regex);
  return match ? match[1] === "true" : undefined;
}

/**
 * Parse a TOML array value.
 */
function parseTomlArray(content: string, key: string): string[] | undefined {
  const regex = new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)]`, "m");
  const match = content.match(regex);
  if (!match) return undefined;

  // Parse array elements (simple string array)
  const arrayContent = match[1];
  const elements: string[] = [];
  const elementRegex = /"([^"]*)"/g;
  let elemMatch;
  while ((elemMatch = elementRegex.exec(arrayContent)) !== null) {
    elements.push(elemMatch[1]);
  }
  return elements;
}

/**
 * Parse a TOML inline table.
 */
function parseTomlInlineTable(
  content: string,
  key: string
): Record<string, string> | undefined {
  const regex = new RegExp(`^${key}\\s*=\\s*\\{([^}]*)}`, "m");
  const match = content.match(regex);
  if (!match) return undefined;

  const tableContent = match[1];
  const result: Record<string, string> = {};
  const pairRegex = /(\w+)\s*=\s*"([^"]*)"/g;
  let pairMatch;
  while ((pairMatch = pairRegex.exec(tableContent)) !== null) {
    result[pairMatch[1]] = pairMatch[2];
  }
  return result;
}

/**
 * Parse MCP servers for a session.
 */
export async function parseSessionMCPConfig(
  sessionId: string,
  agentProvider: AgentProviderType,
  projectPath: string | null
): Promise<SessionMCPConfig> {
  // Check if MCP is supported
  if (agentProvider === "opencode" || agentProvider === "none" || !agentProvider) {
    return {
      sessionId,
      agentProvider: agentProvider || "none",
      projectPath: projectPath || "",
      servers: [],
      mcpSupported: false,
      configFilesChecked: [],
      configFilesFound: [],
      parsedAt: new Date(),
    };
  }

  if (!projectPath) {
    return {
      sessionId,
      agentProvider,
      projectPath: "",
      servers: [],
      mcpSupported: true,
      error: "No project path configured for session",
      configFilesChecked: [],
      configFilesFound: [],
      parsedAt: new Date(),
    };
  }

  const configPaths = getConfigPaths(agentProvider, projectPath);
  const configFilesFound: string[] = [];
  const allServers: ParsedMCPServer[] = [];
  const seenServerNames = new Set<string>();

  // Parse configs in order of precedence (project before global)
  for (const configPath of configPaths) {
    if (!(await fileExists(configPath))) {
      continue;
    }

    configFilesFound.push(configPath);

    try {
      let servers: ParsedMCPServer[] = [];

      switch (agentProvider) {
        case "claude":
          servers = await parseClaudeConfig(configPath);
          break;
        case "gemini":
          servers = await parseGeminiConfig(configPath);
          break;
        case "codex":
          servers = await parseCodexConfig(configPath);
          break;
      }

      // Add servers that haven't been seen yet (project overrides global)
      for (const server of servers) {
        if (!seenServerNames.has(server.name)) {
          seenServerNames.add(server.name);
          allServers.push(server);
        }
      }
    } catch (error) {
      console.error(`Error parsing MCP config ${configPath}:`, error);
    }
  }

  return {
    sessionId,
    agentProvider,
    projectPath,
    servers: allServers,
    mcpSupported: true,
    configFilesChecked: configPaths,
    configFilesFound,
    parsedAt: new Date(),
  };
}

/**
 * Update an MCP server in the config file.
 * Only supports toggling enabled state for now.
 */
export async function updateMCPServerConfig(
  agentProvider: AgentProviderType,
  sourceFile: string,
  serverName: string,
  updates: UpdateMCPServerConfigInput
): Promise<void> {
  if (agentProvider === "opencode" || agentProvider === "none") {
    throw new Error("MCP not supported for this agent");
  }

  const content = await readFile(sourceFile, "utf-8");

  if (agentProvider === "claude" || agentProvider === "gemini") {
    // JSON format - parse, update, and write back
    const config = JSON.parse(content);
    if (!config.mcpServers || !config.mcpServers[serverName]) {
      throw new Error(`Server ${serverName} not found in config`);
    }

    if (updates.enabled !== undefined) {
      config.mcpServers[serverName].disabled = !updates.enabled;
    }
    if (updates.command !== undefined) {
      config.mcpServers[serverName].command = updates.command;
    }
    if (updates.args !== undefined) {
      config.mcpServers[serverName].args = updates.args;
    }
    if (updates.env !== undefined) {
      config.mcpServers[serverName].env = updates.env;
    }

    await writeFile(sourceFile, JSON.stringify(config, null, 2), "utf-8");
  } else if (agentProvider === "codex") {
    // TOML format - for now, only support simple updates
    // Full TOML editing would require a proper parser
    throw new Error("TOML config editing not yet implemented");
  }
}

/**
 * Check if an agent provider supports MCP.
 */
export function isMCPSupported(agentProvider: AgentProviderType | null): boolean {
  return agentProvider === "claude" || agentProvider === "gemini" || agentProvider === "codex";
}
