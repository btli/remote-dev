/**
 * MCP Tools Index
 *
 * Aggregates all tools from domain-specific modules.
 */
import { sessionTools } from "./session-tools";
import { gitTools } from "./git-tools";
import { folderTools } from "./folder-tools";
import { orchestratorTools } from "./orchestrator-tools";
import type { RegisteredTool } from "../types";

/**
 * All registered MCP tools, grouped by domain:
 *
 * Session Tools:
 * - session_list, session_create, session_get
 * - session_execute, session_read_output
 * - session_suspend, session_resume, session_close, session_update
 *
 * Git Tools:
 * - git_validate_repo, git_branches
 * - git_worktree_create, git_worktree_list, git_worktree_status, git_worktree_remove
 * - github_repos_list, github_clone, github_issues
 *
 * Folder Tools:
 * - folder_list, folder_create, folder_update, folder_delete
 * - preferences_get, preferences_set
 *
 * Orchestrator Tools:
 * - session_send_input, session_get_insights, orchestrator_status
 */
export const allTools: RegisteredTool[] = [
  ...sessionTools,
  ...gitTools,
  ...folderTools,
  ...orchestratorTools,
];

/**
 * Get a tool by name
 */
export function getTool(name: string): RegisteredTool | undefined {
  return allTools.find((t) => t.name === name);
}

/**
 * List all tool names
 */
export function listToolNames(): string[] {
  return allTools.map((t) => t.name);
}
