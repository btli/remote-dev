/**
 * MCP Registry - Tool, Resource, and Prompt Registration
 *
 * Provides type-safe builder functions for creating MCP components.
 * Handles Zod schema conversion to JSON Schema for MCP protocol.
 */
import type { ZodType } from "zod";
import type {
  ToolDefinition,
  RegisteredTool,
  ResourceDefinition,
  RegisteredResource,
  PromptDefinition,
  RegisteredPrompt,
  MCPUserContext,
  ToolResult,
} from "./types";
import { formatError } from "./utils/error-handler";

/**
 * Convert a Zod schema to JSON Schema format.
 *
 * Zod v4 has native JSON Schema support via toJsonSchema().
 * We use this instead of the external zod-to-json-schema package.
 */
function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  // Zod v4 provides native JSON Schema conversion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonSchema = (schema as any).toJsonSchema() as Record<string, unknown>;

  // Remove $schema property if present (not needed for MCP)
  delete jsonSchema.$schema;

  return jsonSchema;
}

/**
 * Create a registered tool from a tool definition.
 *
 * Converts the Zod schema to JSON Schema for MCP protocol,
 * and wraps the handler with error handling.
 */
export function createTool<TInput>(
  definition: ToolDefinition<TInput>
): RegisteredTool {
  // Convert Zod schema to JSON Schema using native Zod v4 method
  const inputSchema = zodToJsonSchema(definition.inputSchema);

  return {
    name: definition.name,
    description: definition.description,
    inputSchema,
    handler: async (
      input: unknown,
      context: MCPUserContext
    ): Promise<ToolResult> => {
      try {
        // Validate input with Zod schema
        const validatedInput = definition.inputSchema.parse(input);

        // Call the actual handler
        return await definition.handler(validatedInput, context);
      } catch (error) {
        // Format error with verbose details
        return formatError(error, {
          tool: definition.name,
          input,
        });
      }
    },
  };
}

/**
 * Create a registered resource from a resource definition.
 */
export function createResource(
  definition: ResourceDefinition
): RegisteredResource {
  return {
    uri: definition.uri,
    name: definition.name,
    description: definition.description,
    mimeType: definition.mimeType,
    handler: definition.handler,
  };
}

/**
 * Create a registered prompt from a prompt definition.
 */
export function createPrompt(definition: PromptDefinition): RegisteredPrompt {
  return {
    name: definition.name,
    description: definition.description,
    arguments: definition.arguments,
    handler: definition.handler,
  };
}

/**
 * Match a URI against a pattern with wildcards.
 *
 * Patterns can include:
 * - Exact matches: "rdv://sessions"
 * - Wildcards: "rdv://sessions/*" matches "rdv://sessions/123"
 * - Named params: "rdv://sessions/{id}" matches "rdv://sessions/123"
 */
export function matchUri(pattern: string, uri: string): boolean {
  // Convert pattern to regex
  // {param} and * both become (.+)
  const regexStr =
    "^" +
    pattern
      .replace(/\{[^}]+\}/g, "([^/]+)")
      .replace(/\*/g, "([^/]+)") +
    "$";

  const regex = new RegExp(regexStr);
  return regex.test(uri);
}

/**
 * Extract parameters from a URI based on a pattern.
 *
 * Example:
 *   extractUriParams("rdv://sessions/{id}", "rdv://sessions/123")
 *   Returns: { id: "123" }
 */
export function extractUriParams(
  pattern: string,
  uri: string
): Record<string, string> {
  const params: Record<string, string> = {};

  // Find parameter names in pattern using matchAll
  const paramNames = Array.from(pattern.matchAll(/\{([^}]+)\}/g)).map(
    (m) => m[1]
  );

  // Convert pattern to regex with capture groups
  const regexStr =
    "^" +
    pattern
      .replace(/\{[^}]+\}/g, "([^/]+)")
      .replace(/\*/g, "([^/]+)") +
    "$";

  const regex = new RegExp(regexStr);
  const matches = uri.match(regex);

  if (matches) {
    paramNames.forEach((name, index) => {
      params[name] = matches[index + 1];
    });
  }

  return params;
}
