/**
 * MCP Server Type Definitions
 *
 * This module defines the core types used throughout the MCP server implementation.
 * It provides type-safe patterns for tools, resources, and prompts.
 */
import { z } from "zod";

/**
 * User context extracted from MCP client metadata or environment.
 * For local trust model, this uses a default user from environment variables.
 */
export interface MCPUserContext {
  userId: string;
}

/**
 * Result returned by tool handlers.
 * Content can include text, images, or resource references.
 */
export interface ToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * Definition for a single MCP tool.
 * Tools are grouped by domain (session_*, git_*, folder_*, etc.)
 */
export interface ToolDefinition<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  handler: (input: TInput, context: MCPUserContext) => Promise<ToolResult>;
}

/**
 * A registered tool with its JSON Schema for MCP protocol.
 */
export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown, context: MCPUserContext) => Promise<ToolResult>;
}

/**
 * Content returned when reading a resource.
 */
export interface ResourceContent {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

/**
 * Definition for an MCP resource.
 * Resources provide read access to data like sessions, folders, etc.
 */
export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: (uri: string, context: MCPUserContext) => Promise<ResourceContent>;
}

/**
 * A registered resource for MCP protocol.
 */
export interface RegisteredResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: (uri: string, context: MCPUserContext) => Promise<ResourceContent>;
}

/**
 * Result returned by prompt handlers.
 * Contains messages that form a conversation template.
 */
export interface PromptResult {
  messages: Array<{
    role: "user" | "assistant";
    content: {
      type: "text";
      text: string;
    };
  }>;
}

/**
 * Definition for an MCP prompt.
 * Prompts provide templates for common workflows.
 */
export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
  handler: (
    args: Record<string, string>,
    context: MCPUserContext
  ) => Promise<PromptResult>;
}

/**
 * A registered prompt for MCP protocol.
 */
export interface RegisteredPrompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
  handler: (
    args: Record<string, string>,
    context: MCPUserContext
  ) => Promise<PromptResult>;
}
