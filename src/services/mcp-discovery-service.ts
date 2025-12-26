/**
 * MCPDiscoveryService - Discovers tools and resources from MCP servers
 *
 * Connects to MCP servers via stdio or HTTP transport and discovers
 * available tools and resources using the MCP protocol.
 */

import { db } from "@/db";
import { mcpDiscoveredTools, mcpDiscoveredResources, mcpServers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { spawn, type ChildProcess } from "child_process";
import type { MCPServer, MCPTool, MCPResource } from "@/types/agent";
import * as MCPRegistryService from "./mcp-registry-service";

// MCP JSON-RPC types
interface MCPRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPToolsListResult {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

interface MCPResourcesListResult {
  resources: Array<{
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
  }>;
}

/**
 * Discovered tool with server info
 */
export interface DiscoveredTool extends MCPTool {
  id: string;
  serverId: string;
  serverName: string;
  discoveredAt: Date;
}

/**
 * Discovered resource with server info
 */
export interface DiscoveredResource extends MCPResource {
  id: string;
  serverId: string;
  serverName: string;
  discoveredAt: Date;
}

/**
 * Discovery result for a single server
 */
export interface ServerDiscoveryResult {
  server: MCPServer;
  tools: MCPTool[];
  resources: MCPResource[];
  error?: string;
}

/**
 * Get all discovered tools for a user
 */
export async function getDiscoveredTools(userId: string): Promise<DiscoveredTool[]> {
  const results = await db
    .select({
      tool: mcpDiscoveredTools,
      server: mcpServers,
    })
    .from(mcpDiscoveredTools)
    .innerJoin(mcpServers, eq(mcpDiscoveredTools.serverId, mcpServers.id))
    .where(eq(mcpServers.userId, userId));

  return results.map((r) => ({
    id: r.tool.id,
    serverId: r.tool.serverId,
    serverName: r.server.name,
    name: r.tool.name,
    description: r.tool.description ?? undefined,
    inputSchema: r.tool.inputSchema ? JSON.parse(r.tool.inputSchema) : undefined,
    discoveredAt: new Date(r.tool.discoveredAt),
  }));
}

/**
 * Get discovered tools for a specific server
 */
export async function getServerTools(serverId: string): Promise<DiscoveredTool[]> {
  const server = await db.query.mcpServers.findFirst({
    where: eq(mcpServers.id, serverId),
  });

  if (!server) {
    return [];
  }

  const tools = await db.query.mcpDiscoveredTools.findMany({
    where: eq(mcpDiscoveredTools.serverId, serverId),
  });

  return tools.map((t) => ({
    id: t.id,
    serverId: t.serverId,
    serverName: server.name,
    name: t.name,
    description: t.description ?? undefined,
    inputSchema: t.inputSchema ? JSON.parse(t.inputSchema) : undefined,
    discoveredAt: new Date(t.discoveredAt),
  }));
}

/**
 * Get all discovered resources for a user
 */
export async function getDiscoveredResources(userId: string): Promise<DiscoveredResource[]> {
  const results = await db
    .select({
      resource: mcpDiscoveredResources,
      server: mcpServers,
    })
    .from(mcpDiscoveredResources)
    .innerJoin(mcpServers, eq(mcpDiscoveredResources.serverId, mcpServers.id))
    .where(eq(mcpServers.userId, userId));

  return results.map((r) => ({
    id: r.resource.id,
    serverId: r.resource.serverId,
    serverName: r.server.name,
    uri: r.resource.uri,
    name: r.resource.name ?? undefined,
    description: r.resource.description ?? undefined,
    mimeType: r.resource.mimeType ?? undefined,
    discoveredAt: new Date(r.resource.discoveredAt),
  }));
}

/**
 * Get discovered resources for a specific server
 */
export async function getServerResources(serverId: string): Promise<DiscoveredResource[]> {
  const server = await db.query.mcpServers.findFirst({
    where: eq(mcpServers.id, serverId),
  });

  if (!server) {
    return [];
  }

  const resources = await db.query.mcpDiscoveredResources.findMany({
    where: eq(mcpDiscoveredResources.serverId, serverId),
  });

  return resources.map((r) => ({
    id: r.id,
    serverId: r.serverId,
    serverName: server.name,
    uri: r.uri,
    name: r.name ?? undefined,
    description: r.description ?? undefined,
    mimeType: r.mimeType ?? undefined,
    discoveredAt: new Date(r.discoveredAt),
  }));
}

/**
 * Discover tools and resources from an MCP server
 */
export async function discoverServer(
  serverId: string,
  userId: string
): Promise<ServerDiscoveryResult> {
  const server = await MCPRegistryService.getServer(serverId, userId);
  if (!server) {
    throw new MCPDiscoveryError("Server not found", "SERVER_NOT_FOUND");
  }

  let tools: MCPTool[] = [];
  let resources: MCPResource[] = [];
  let error: string | undefined;

  try {
    if (server.transport === "stdio") {
      const result = await discoverViaStdio(server);
      tools = result.tools;
      resources = result.resources;
    } else if (server.transport === "http" || server.transport === "sse") {
      const result = await discoverViaHttp(server);
      tools = result.tools;
      resources = result.resources;
    }

    // Store discovered items in database
    await storeDiscoveredItems(serverId, tools, resources);

    // Update health check timestamp
    await MCPRegistryService.updateHealthCheck(serverId, userId);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return { server, tools, resources, error };
}

/**
 * Discover tools/resources from all enabled servers for a user
 */
export async function discoverAll(userId: string): Promise<ServerDiscoveryResult[]> {
  const servers = await MCPRegistryService.getServers(userId);
  const enabledServers = servers.filter((s) => s.enabled);

  const results: ServerDiscoveryResult[] = [];
  for (const server of enabledServers) {
    try {
      const result = await discoverServer(server.id, userId);
      results.push(result);
    } catch {
      results.push({
        server,
        tools: [],
        resources: [],
        error: "Failed to discover server",
      });
    }
  }

  return results;
}

/**
 * Refresh discovery for a specific server (clear cache and re-discover)
 */
export async function refreshServer(
  serverId: string,
  userId: string
): Promise<ServerDiscoveryResult> {
  // Clear existing cached items
  await db.delete(mcpDiscoveredTools).where(eq(mcpDiscoveredTools.serverId, serverId));
  await db.delete(mcpDiscoveredResources).where(eq(mcpDiscoveredResources.serverId, serverId));

  // Re-discover
  return discoverServer(serverId, userId);
}

/**
 * Clear all discovered items for a server
 */
export async function clearServerDiscovery(serverId: string): Promise<void> {
  await db.delete(mcpDiscoveredTools).where(eq(mcpDiscoveredTools.serverId, serverId));
  await db.delete(mcpDiscoveredResources).where(eq(mcpDiscoveredResources.serverId, serverId));
}

// ============================================================================
// Internal Functions
// ============================================================================

/**
 * Discover via stdio transport (spawn process)
 */
async function discoverViaStdio(
  server: MCPServer
): Promise<{ tools: MCPTool[]; resources: MCPResource[] }> {
  return new Promise((resolve, reject) => {
    const timeout = 30000; // 30 seconds
    let resolved = false;

    // Spawn the MCP server process
    const env = { ...process.env, ...server.env };
    const child: ChildProcess = spawn(server.command, server.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        reject(new Error("Discovery timeout"));
      }
    }, timeout);

    let stdout = "";
    let requestId = 0;
    const pendingRequests = new Map<number, {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }>();

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();

      // Try to parse complete JSON-RPC responses
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? ""; // Keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response: MCPResponse = JSON.parse(line);
          const pending = pendingRequests.get(response.id);
          if (pending) {
            pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch {
          // Ignore parse errors for incomplete messages
        }
      }
    });

    child.on("error", (error: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        reject(error);
      }
    });

    const sendRequest = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      return new Promise((res, rej) => {
        const id = ++requestId;
        const request: MCPRequest = {
          jsonrpc: "2.0",
          id,
          method,
          params,
        };
        pendingRequests.set(id, { resolve: res, reject: rej });
        child.stdin?.write(JSON.stringify(request) + "\n");
      });
    };

    // Start discovery sequence
    (async () => {
      try {
        // Initialize
        await sendRequest("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "remote-dev", version: "1.0.0" },
        });

        // List tools
        const toolsResult = (await sendRequest("tools/list")) as MCPToolsListResult;
        const tools: MCPTool[] = (toolsResult?.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));

        // List resources
        let resources: MCPResource[] = [];
        try {
          const resourcesResult = (await sendRequest("resources/list")) as MCPResourcesListResult;
          resources = (resourcesResult?.resources ?? []).map((r) => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
          }));
        } catch {
          // resources/list may not be supported
        }

        // Clean shutdown
        child.kill();
        clearTimeout(timeoutId);

        if (!resolved) {
          resolved = true;
          resolve({ tools, resources });
        }
      } catch (error) {
        child.kill();
        clearTimeout(timeoutId);
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      }
    })();
  });
}

/**
 * Discover via HTTP transport
 */
async function discoverViaHttp(
  server: MCPServer
): Promise<{ tools: MCPTool[]; resources: MCPResource[] }> {
  // For HTTP transport, the command should be the base URL
  const baseUrl = server.command;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Add auth headers from env if present
  if (server.env.AUTHORIZATION) {
    headers.Authorization = server.env.AUTHORIZATION;
  }

  const sendRequest = async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result: MCPResponse = await response.json();
    if (result.error) {
      throw new Error(result.error.message);
    }

    return result.result;
  };

  // Initialize
  await sendRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "remote-dev", version: "1.0.0" },
  });

  // List tools
  const toolsResult = (await sendRequest("tools/list")) as MCPToolsListResult;
  const tools: MCPTool[] = (toolsResult?.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  // List resources
  let resources: MCPResource[] = [];
  try {
    const resourcesResult = (await sendRequest("resources/list")) as MCPResourcesListResult;
    resources = (resourcesResult?.resources ?? []).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  } catch {
    // resources/list may not be supported
  }

  return { tools, resources };
}

/**
 * Store discovered tools and resources in database
 */
async function storeDiscoveredItems(
  serverId: string,
  tools: MCPTool[],
  resources: MCPResource[]
): Promise<void> {
  const now = new Date();

  // Clear existing and insert new tools
  await db.delete(mcpDiscoveredTools).where(eq(mcpDiscoveredTools.serverId, serverId));
  if (tools.length > 0) {
    await db.insert(mcpDiscoveredTools).values(
      tools.map((t) => ({
        serverId,
        name: t.name,
        description: t.description ?? null,
        inputSchema: t.inputSchema ? JSON.stringify(t.inputSchema) : null,
        discoveredAt: now,
      }))
    );
  }

  // Clear existing and insert new resources
  await db.delete(mcpDiscoveredResources).where(eq(mcpDiscoveredResources.serverId, serverId));
  if (resources.length > 0) {
    await db.insert(mcpDiscoveredResources).values(
      resources.map((r) => ({
        serverId,
        uri: r.uri,
        name: r.name ?? null,
        description: r.description ?? null,
        mimeType: r.mimeType ?? null,
        discoveredAt: now,
      }))
    );
  }
}

/**
 * Search tools by name or description
 */
export async function searchTools(
  userId: string,
  query: string
): Promise<DiscoveredTool[]> {
  const allTools = await getDiscoveredTools(userId);
  const lowerQuery = query.toLowerCase();

  return allTools.filter(
    (t) =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description?.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get tools grouped by server
 */
export async function getToolsByServer(
  userId: string
): Promise<Map<string, DiscoveredTool[]>> {
  const allTools = await getDiscoveredTools(userId);
  const grouped = new Map<string, DiscoveredTool[]>();

  for (const tool of allTools) {
    const existing = grouped.get(tool.serverName) ?? [];
    existing.push(tool);
    grouped.set(tool.serverName, existing);
  }

  return grouped;
}

// Error class for service-specific errors
export class MCPDiscoveryError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "MCPDiscoveryError";
  }
}
