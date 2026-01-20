/**
 * Remote Dev MCP Server
 *
 * Model Context Protocol server for terminal session management.
 * Provides tools, resources, and prompts for AI agents to interact
 * with the Remote Dev application.
 *
 * Transport: stdio (for Claude Desktop, Cursor, etc.)
 * Auth: Local trust (no authentication required)
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type CallToolResult,
  type GetPromptResult,
} from "@modelcontextprotocol/sdk/types.js";

import { allTools, getTool } from "./tools/index.js";
import { allResources, findResource } from "./resources/index.js";
import { allPrompts, findPrompt } from "./prompts/index.js";
import { getUserContext } from "./utils/auth.js";
import { formatError } from "./utils/error-handler.js";

let mcpServer: Server | null = null;
let transport: StdioServerTransport | null = null;

/**
 * Initialize and start the MCP server on stdio transport.
 *
 * This should be called from the terminal server entry point
 * when MCP_ENABLED=true.
 */
export async function initializeMCPServer(): Promise<void> {
  // Create MCP server with full capabilities
  mcpServer = new Server(
    {
      name: "remote-dev",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // Register tool handlers
  registerToolHandlers(mcpServer);

  // Register resource handlers
  registerResourceHandlers(mcpServer);

  // Register prompt handlers
  registerPromptHandlers(mcpServer);

  // Start stdio transport
  transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error("[MCP] Server initialized on stdio transport");
  console.error(`[MCP] Registered ${allTools.length} tools`);
  console.error(`[MCP] Registered ${allResources.length} resources`);
  console.error(`[MCP] Registered ${allPrompts.length} prompts`);
}

/**
 * Gracefully shutdown the MCP server.
 */
export async function shutdownMCPServer(): Promise<void> {
  if (transport) {
    await transport.close();
    transport = null;
  }
  mcpServer = null;
  console.error("[MCP] Server shutdown");
}

/**
 * Register all tool handlers with the MCP server.
 */
function registerToolHandlers(server: Server): void {
  // List all available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    const tool = getTool(name);
    if (!tool) {
      const errorResult = formatError(new Error(`Unknown tool: ${name}`), { tool: name });
      return errorResult as CallToolResult;
    }

    try {
      const context = getUserContext();
      const result = await tool.handler(args, context);
      return result as CallToolResult;
    } catch (error) {
      console.error(`[MCP] Tool error: ${name}`, error);
      const errorResult = formatError(error, { tool: name, input: args });
      return errorResult as CallToolResult;
    }
  });
}

/**
 * Register all resource handlers with the MCP server.
 */
function registerResourceHandlers(server: Server): void {
  // List all available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: allResources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      })),
    };
  });

  // Read resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    const resource = findResource(uri);
    if (!resource) {
      throw new Error(`Resource not found: ${uri}`);
    }

    try {
      const context = getUserContext();
      const content = await resource.handler(uri, context);
      return {
        contents: [content],
      };
    } catch (error) {
      console.error(`[MCP] Resource error: ${uri}`, error);
      throw error;
    }
  });
}

/**
 * Register all prompt handlers with the MCP server.
 */
function registerPromptHandlers(server: Server): void {
  // List all available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: allPrompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments,
      })),
    };
  });

  // Get prompt content
  server.setRequestHandler(GetPromptRequestSchema, async (request): Promise<GetPromptResult> => {
    const { name, arguments: args } = request.params;

    const prompt = findPrompt(name);
    if (!prompt) {
      throw new Error(`Prompt not found: ${name}`);
    }

    try {
      const context = getUserContext();
      const result = await prompt.handler(args || {}, context);
      return result as GetPromptResult;
    } catch (error) {
      console.error(`[MCP] Prompt error: ${name}`, error);
      throw error;
    }
  });
}

/**
 * Check if MCP server is running.
 */
export function isMCPServerRunning(): boolean {
  return mcpServer !== null && transport !== null;
}

/**
 * Get MCP server status for health checks.
 */
export function getMCPServerStatus(): {
  running: boolean;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
} {
  return {
    running: isMCPServerRunning(),
    toolCount: allTools.length,
    resourceCount: allResources.length,
    promptCount: allPrompts.length,
  };
}
