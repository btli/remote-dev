/**
 * MCP Error Handling Utilities
 *
 * Provides verbose error formatting for debugging.
 * All errors include full context, stack traces, and recovery hints.
 */
import type { ToolResult } from "../types";

/**
 * Service error codes from the application.
 * Maps to human-readable recovery hints.
 */
const ERROR_RECOVERY_HINTS: Record<string, string> = {
  SESSION_NOT_FOUND: "Check the session ID is correct and the session exists.",
  TMUX_SESSION_GONE: "The terminal session was terminated. Create a new session.",
  NOT_GIT_REPO: "The specified path is not a git repository. Check the path.",
  REPO_NOT_CLONED: "Clone the repository first using git_clone tool.",
  NO_REPO_LINKED: "Link a repository to the folder in folder preferences.",
  BRANCH_EXISTS: "The branch already exists. Use a different branch name.",
  HAS_UNCOMMITTED_CHANGES: "Commit or stash changes before removing the worktree.",
  HAS_UNPUSHED_COMMITS: "Push commits before removing the worktree, or use force.",
  FOLDER_NOT_FOUND: "Check the folder ID is correct and the folder exists.",
  GITHUB_NOT_CONNECTED: "Connect GitHub account in settings first.",
};

/**
 * Format an error into a verbose MCP tool result.
 *
 * Includes:
 * - Error message
 * - Error code (if available)
 * - Stack trace
 * - Recovery hints
 * - Original context
 */
export function formatError(
  error: unknown,
  context?: { tool?: string; input?: unknown }
): ToolResult {
  const isError = error instanceof Error;
  const message = isError ? error.message : String(error);
  const stack = isError ? error.stack : undefined;

  // Extract error code if available (from service errors)
  const code =
    isError && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;

  // Get recovery hint if we have a known error code
  const recoveryHint = code ? ERROR_RECOVERY_HINTS[code] : undefined;

  // Build verbose error response
  const errorDetails: Record<string, unknown> = {
    success: false,
    error: message,
  };

  if (code) {
    errorDetails.code = code;
  }

  if (recoveryHint) {
    errorDetails.hint = recoveryHint;
  }

  if (stack) {
    errorDetails.stack = stack;
  }

  if (context?.tool) {
    errorDetails.tool = context.tool;
  }

  if (context?.input) {
    errorDetails.input = context.input;
  }

  // Log to stderr for debugging (doesn't interfere with stdio transport)
  console.error("[MCP Error]", JSON.stringify(errorDetails, null, 2));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(errorDetails, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Create a success result with JSON data.
 */
export function successResult(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Create a success result with plain text.
 */
export function textResult(text: string): ToolResult {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

/**
 * Create an error result with a message and optional code.
 */
export function errorResult(message: string, code?: string): ToolResult {
  const error = new Error(message);
  if (code) {
    (error as Error & { code?: string }).code = code;
  }
  return formatError(error);
}
