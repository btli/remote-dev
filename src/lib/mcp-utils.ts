/**
 * MCP Utility Functions
 *
 * Browser-safe utility functions for MCP operations.
 * These can be imported in both client and server components.
 */

import type { ParsedMCPServer } from "@/types/agent-mcp";

/**
 * Create a unique key for a server (used for caching).
 */
export function getServerKey(server: ParsedMCPServer): string {
  return `${server.name}::${server.sourceFile}`;
}

/**
 * Create a unique key from server name and source file.
 */
export function makeServerKey(serverName: string, sourceFile: string): string {
  return `${serverName}::${sourceFile}`;
}

/**
 * Transport type display configuration for MCP servers.
 */
export const TRANSPORT_CONFIG: Record<string, { label: string; className: string }> = {
  stdio: { label: "stdio", className: "bg-blue-500/20 text-blue-400" },
  http: { label: "http", className: "bg-green-500/20 text-green-400" },
  sse: { label: "sse", className: "bg-purple-500/20 text-purple-400" },
};
