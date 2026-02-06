/**
 * Session MCP Discovery Service
 *
 * Session-scoped MCP tool discovery without database persistence.
 * Used by agent sessions to discover tools from MCP servers defined
 * in their config files (.mcp.json, etc.).
 *
 * Unlike mcp-discovery-service.ts which persists to database,
 * this service returns results directly for in-memory caching.
 */

import {
  discoverViaStdio,
  discoverViaHttp,
  DEFAULT_DISCOVERY_TIMEOUT,
  type DiscoveryResult,
} from "./mcp-discovery";
import type {
  ParsedMCPServer,
  SessionDiscoveryStatus,
  SessionServerDiscoveryResult,
} from "@/types/agent-mcp";

// Re-export types for convenience
export type { SessionDiscoveryStatus, SessionServerDiscoveryResult };

// =============================================================================
// Discovery Functions
// =============================================================================

/**
 * Discover tools and resources from a single MCP server.
 * Does not persist results - returns them directly.
 */
export async function discoverSessionServer(
  server: ParsedMCPServer,
  timeout: number = DEFAULT_DISCOVERY_TIMEOUT
): Promise<SessionServerDiscoveryResult> {
  const startTime = Date.now();

  // Check if server is enabled
  if (!server.enabled) {
    return {
      serverName: server.name,
      sourceFile: server.sourceFile,
      tools: [],
      resources: [],
      discoveryStatus: "error",
      error: "Server is disabled",
      discoveredAt: new Date(),
    };
  }

  try {
    let result: DiscoveryResult;

    if (server.transport === "stdio") {
      result = await discoverViaStdio(
        {
          command: server.command,
          args: server.args,
          env: server.env,
        },
        timeout
      );
    } else if (server.transport === "http" || server.transport === "sse") {
      // For HTTP/SSE, the command is the URL
      result = await discoverViaHttp(
        {
          url: server.command,
          headers: server.env.AUTHORIZATION
            ? { Authorization: server.env.AUTHORIZATION }
            : undefined,
        },
        timeout
      );
    } else {
      throw new Error(`Unsupported transport: ${server.transport}`);
    }

    return {
      serverName: server.name,
      sourceFile: server.sourceFile,
      tools: result.tools,
      resources: result.resources,
      discoveryStatus: "completed",
      discoveredAt: new Date(),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const isTimeout = duration >= timeout - 100; // Allow some margin

    return {
      serverName: server.name,
      sourceFile: server.sourceFile,
      tools: [],
      resources: [],
      discoveryStatus: isTimeout ? "timeout" : "error",
      error: error instanceof Error ? error.message : "Discovery failed",
      discoveredAt: new Date(),
    };
  }
}

/**
 * Discover tools and resources from multiple MCP servers in parallel.
 * Returns results for all servers, including failures.
 */
export async function discoverAllSessionServers(
  servers: ParsedMCPServer[],
  timeout: number = DEFAULT_DISCOVERY_TIMEOUT
): Promise<SessionServerDiscoveryResult[]> {
  // Only discover enabled servers
  const enabledServers = servers.filter((s) => s.enabled);

  if (enabledServers.length === 0) {
    return [];
  }

  // Run discoveries in parallel
  const results = await Promise.allSettled(
    enabledServers.map((server) => discoverSessionServer(server, timeout))
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    // Handle rejected promise (shouldn't happen since discoverSessionServer catches errors)
    const server = enabledServers[index];
    return {
      serverName: server.name,
      sourceFile: server.sourceFile,
      tools: [],
      resources: [],
      discoveryStatus: "error" as const,
      error: result.reason instanceof Error ? result.reason.message : "Discovery failed",
      discoveredAt: new Date(),
    };
  });
}

// Re-export utility functions from browser-safe module
export { getServerKey, makeServerKey } from "@/lib/mcp-utils";
