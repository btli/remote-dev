/**
 * Shared types for Claude Code session discovery.
 * Used by both the server service and client modal.
 */

export interface ClaudeSessionSummary {
  sessionId: string;
  cwd: string;
  gitBranch?: string;
  version?: string;
  timestamp: string;
  lastModified: string;
  firstUserMessage?: string;
}
