#!/usr/bin/env node
/**
 * Remote Dev MCP Server (Standalone)
 *
 * A standalone MCP server for orchestrator sessions.
 * Proxies requests to the remote-dev API via HTTP or Unix socket.
 *
 * Usage: node scripts/mcp-server.mjs
 *
 * Environment:
 *   SOCKET_PATH - Unix socket path (production, takes precedence)
 *   REMOTE_DEV_URL - API base URL (development fallback: http://localhost:6001)
 *   MCP_USER_ID - User ID for API requests
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import http from "http";

const SOCKET_PATH = process.env.SOCKET_PATH;
const REMOTE_DEV_URL = process.env.REMOTE_DEV_URL || "http://localhost:6001";
const USER_ID = process.env.MCP_USER_ID;

/**
 * Make an API request to remote-dev
 * Supports both Unix socket (production) and HTTP (development)
 */
async function apiRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const data = options.body ? JSON.stringify(options.body) : null;

    let reqOptions;
    if (SOCKET_PATH) {
      // Unix socket mode (production)
      reqOptions = {
        socketPath: SOCKET_PATH,
        path,
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(data && { "Content-Length": Buffer.byteLength(data) }),
        },
      };
    } else {
      // HTTP mode (development)
      const url = new URL(path, REMOTE_DEV_URL);
      reqOptions = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(data && { "Content-Length": Buffer.byteLength(data) }),
        },
      };
    }

    const req = http.request(reqOptions, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`API error: ${res.statusCode} - ${body}`));
        } else {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Define tools that proxy to remote-dev API
 */
const tools = [
  {
    name: "session_list",
    description: "List all terminal sessions",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "suspended", "closed", "all"],
          description: "Filter by status",
        },
        folderId: {
          type: "string",
          description: "Filter by folder ID",
        },
      },
    },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.folderId) params.set("folderId", args.folderId);
      const query = params.toString() ? `?${params}` : "";
      return apiRequest(`/api/sessions${query}`);
    },
  },
  {
    name: "session_get",
    description: "Get details of a specific session",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
      },
      required: ["sessionId"],
    },
    handler: async (args) => {
      return apiRequest(`/api/sessions/${args.sessionId}`);
    },
  },
  {
    name: "session_exec",
    description: "Execute a command in a terminal session",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        command: { type: "string", description: "Command to execute" },
      },
      required: ["sessionId", "command"],
    },
    handler: async (args) => {
      return apiRequest(`/api/sessions/${args.sessionId}/exec`, {
        method: "POST",
        body: JSON.stringify({ command: args.command }),
      });
    },
  },
  {
    name: "orchestrator_status",
    description: "Get status of all orchestrators",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return apiRequest("/api/orchestrators");
    },
  },
  {
    name: "orchestrator_insights",
    description: "Get insights from an orchestrator",
    inputSchema: {
      type: "object",
      properties: {
        orchestratorId: { type: "string", description: "Orchestrator ID" },
        status: {
          type: "string",
          enum: ["pending", "acknowledged", "resolved", "all"],
        },
      },
      required: ["orchestratorId"],
    },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      const query = params.toString() ? `?${params}` : "";
      return apiRequest(`/api/orchestrators/${args.orchestratorId}/insights${query}`);
    },
  },
  {
    name: "folder_list",
    description: "List all folders",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return apiRequest("/api/folders");
    },
  },
  {
    name: "folder_get",
    description: "Get folder details including orchestrator status",
    inputSchema: {
      type: "object",
      properties: {
        folderId: { type: "string", description: "Folder ID" },
      },
      required: ["folderId"],
    },
    handler: async (args) => {
      return apiRequest(`/api/folders/${args.folderId}`);
    },
  },
  {
    name: "folder_hooks_status",
    description: "Check hook installation status for a folder",
    inputSchema: {
      type: "object",
      properties: {
        folderId: { type: "string", description: "Folder ID" },
      },
      required: ["folderId"],
    },
    handler: async (args) => {
      return apiRequest(`/api/folders/${args.folderId}/hooks`);
    },
  },
  {
    name: "session_analyze",
    description: "Analyze session scrollback for patterns and activity",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        lines: {
          type: "number",
          description: "Number of lines to analyze (default: 100)",
        },
      },
      required: ["sessionId"],
    },
    handler: async (args) => {
      // This would need a dedicated endpoint for scrollback analysis
      // For now, return session info
      const session = await apiRequest(`/api/sessions/${args.sessionId}`);
      return {
        session,
        analysis: {
          note: "Full scrollback analysis requires direct tmux access via terminal server",
        },
      };
    },
  },
];

/**
 * Main entry point
 */
async function main() {
  const server = new Server(
    {
      name: "remote-dev-proxy",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing
  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => ({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    })
  );

  // Register tool execution
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      const { name, arguments: args } = request.params;
      const tool = tools.find((t) => t.name === name);

      if (!tool) {
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }

      try {
        const result = await tool.handler(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[MCP] Remote Dev proxy server started");
  console.error(`[MCP] API URL: ${REMOTE_DEV_URL}`);
  console.error(`[MCP] Available tools: ${tools.length}`);
}

main().catch(console.error);
