/**
 * MCP Tools Index
 *
 * Aggregates all tools from domain-specific modules.
 */
import { sessionTools } from "./session-tools.js";
import { gitTools } from "./git-tools.js";
import { folderTools } from "./folder-tools.js";
import { profileTools } from "./profile-tools.js";
import type { RegisteredTool } from "../types.js";

/**
 * All registered MCP tools, grouped by domain:
 *
 * Session Tools:
 * - session_list, session_create, session_get
 * - session_execute, session_read_output
 * - session_suspend, session_resume, session_close, session_update
 * - session_restart_agent, session_close_agent
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
 * Profile Tools:
 * - profile_list, profile_create, profile_get, profile_update, profile_delete
 * - profile_set_git_identity, profile_link_folder, profile_unlink_folder
 */
export const allTools: RegisteredTool[] = [
  ...sessionTools,
  ...gitTools,
  ...folderTools,
  ...profileTools,
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
