/**
 * MCP Authentication Utilities
 *
 * For the local trust model, we use a default user ID from environment variables.
 * This can be extended for multi-user support in the future.
 */
import type { MCPUserContext } from "../types.js";

/**
 * Default user ID for local trust model.
 * Set MCP_USER_ID environment variable to override.
 */
const DEFAULT_USER_ID = process.env.MCP_USER_ID || "mcp-local-user";

/**
 * Extract user context for MCP operations.
 *
 * In local trust mode, returns a fixed user ID from environment.
 * This can be extended to extract user info from MCP client metadata
 * if authentication is added in the future.
 */
export function getUserContext(): MCPUserContext {
  return {
    userId: DEFAULT_USER_ID,
  };
}

/**
 * Check if the user context is valid.
 * For local trust, always returns true.
 */
export function isValidUserContext(context: MCPUserContext): boolean {
  return Boolean(context.userId);
}
