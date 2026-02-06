/**
 * MCP Discovery Core Utilities
 *
 * Pure functions for discovering tools and resources from MCP servers.
 * These utilities are transport-agnostic and have no database dependencies.
 *
 * Used by:
 * - mcp-discovery-service.ts (DB-backed registry)
 * - session-mcp-discovery-service.ts (session-scoped, no DB)
 */

import { spawn, type ChildProcess } from "child_process";

// =============================================================================
// Types
// =============================================================================

export interface MCPServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface MCPHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface DiscoveredResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface DiscoveryResult {
  tools: DiscoveredTool[];
  resources: DiscoveredResource[];
}

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

// =============================================================================
// Configuration
// =============================================================================

/** Default timeout for discovery operations (ms) */
export const DEFAULT_DISCOVERY_TIMEOUT = 30000;

/** MCP protocol version */
const MCP_PROTOCOL_VERSION = "2024-11-05";

/** Client info sent during initialization */
const CLIENT_INFO = { name: "remote-dev", version: "1.0.0" };

// =============================================================================
// Stdio Discovery
// =============================================================================

/**
 * Discover tools and resources from an MCP server via stdio transport.
 * Spawns the server process, communicates via stdin/stdout, then terminates.
 */
export async function discoverViaStdio(
  config: MCPServerConfig,
  timeout: number = DEFAULT_DISCOVERY_TIMEOUT
): Promise<DiscoveryResult> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Merge process env with server-specific env
    const env = { ...process.env, ...config.env };

    // Track pending requests for cleanup
    const pendingRequests = new Map<
      number,
      {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }
    >();

    // Spawn the MCP server process
    const child: ChildProcess = spawn(config.command, config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    // Cleanup function to ensure resources are freed
    const cleanup = (error?: Error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      // Reject all pending requests
      const terminationError = error ?? new Error("Process terminated");
      pendingRequests.forEach(({ reject: rej }) => {
        rej(terminationError);
      });
      pendingRequests.clear();

      // Kill child process if still running
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };

    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup(new Error(`Discovery timeout after ${timeout}ms`));
        reject(new Error(`Discovery timeout after ${timeout}ms`));
      }
    }, timeout);

    let stdout = "";
    let requestId = 0;

    // Handle stdout data - parse JSON-RPC responses
    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();

      // Parse complete lines (JSON-RPC uses newline-delimited JSON)
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? ""; // Keep incomplete line in buffer

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
          // Ignore parse errors for incomplete/invalid messages
        }
      }
    });

    // Capture stderr for debugging
    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Handle process errors
    child.on("error", (error: Error) => {
      if (!resolved) {
        resolved = true;
        cleanup(error);
        reject(error);
      }
    });

    // Handle unexpected process exit
    child.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        const errorMsg = stderr
          ? `Process exited with code ${code}: ${stderr.slice(0, 200)}`
          : `Process exited unexpectedly with code ${code}`;
        const error = new Error(errorMsg);
        cleanup(error);
        reject(error);
      }
    });

    // Helper to send JSON-RPC request
    const sendRequest = (
      method: string,
      params?: Record<string, unknown>
    ): Promise<unknown> => {
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

    // Helper to send JSON-RPC notification (no response expected)
    const sendNotification = (
      method: string,
      params?: Record<string, unknown>
    ): void => {
      const notification = {
        jsonrpc: "2.0",
        method,
        params,
      };
      child.stdin?.write(JSON.stringify(notification) + "\n");
    };

    // Discovery sequence
    (async () => {
      try {
        // Initialize connection
        await sendRequest("initialize", {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        });

        // Send initialized notification (required by MCP protocol)
        sendNotification("notifications/initialized");

        // List tools
        const toolsResult = (await sendRequest("tools/list")) as MCPToolsListResult;
        const tools = mapToolsResult(toolsResult);

        // List resources (optional - may not be supported)
        const resources = await fetchResourcesSafe(sendRequest);

        if (!resolved) {
          resolved = true;
          cleanup(); // Clean shutdown
          resolve({ tools, resources });
        }
      } catch (error) {
        if (!resolved) {
          resolved = true;
          cleanup(error instanceof Error ? error : new Error(String(error)));
          reject(error);
        }
      }
    })();
  });
}

// =============================================================================
// HTTP Discovery
// =============================================================================

/**
 * Discover tools and resources from an MCP server via HTTP transport.
 * Sends JSON-RPC requests to the server URL.
 */
export async function discoverViaHttp(
  config: MCPHttpConfig,
  timeout: number = DEFAULT_DISCOVERY_TIMEOUT
): Promise<DiscoveryResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...config.headers,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const sendRequest = async (
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> => {
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
      signal: controller.signal,
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

  // Send notification (no response expected)
  const sendNotification = async (
    method: string,
    params?: Record<string, unknown>
  ): Promise<void> => {
    await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      }),
      signal: controller.signal,
    });
  };

  try {
    // Initialize connection
    await sendRequest("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });

    // Send initialized notification (required by MCP protocol)
    await sendNotification("notifications/initialized");

    // List tools
    const toolsResult = (await sendRequest("tools/list")) as MCPToolsListResult;
    const tools = mapToolsResult(toolsResult);

    // List resources (optional - may not be supported)
    const resources = await fetchResourcesSafe(sendRequest);

    return { tools, resources };
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Map raw tools result to domain type.
 */
function mapToolsResult(result: MCPToolsListResult | null): DiscoveredTool[] {
  return (result?.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

/**
 * Map raw resources result to domain type.
 */
function mapResourcesResult(
  result: MCPResourcesListResult | null
): DiscoveredResource[] {
  return (result?.resources ?? []).map((r) => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
  }));
}

/**
 * Safely fetch resources (may not be supported by all servers).
 */
async function fetchResourcesSafe(
  sendRequest: (
    method: string,
    params?: Record<string, unknown>
  ) => Promise<unknown>
): Promise<DiscoveredResource[]> {
  try {
    const result = (await sendRequest("resources/list")) as MCPResourcesListResult;
    return mapResourcesResult(result);
  } catch {
    // Server doesn't support resources - return empty array
    return [];
  }
}
