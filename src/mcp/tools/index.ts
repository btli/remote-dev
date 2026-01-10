/**
 * MCP Tools Index
 *
 * Aggregates all tools from domain-specific modules.
 */
import { sessionTools } from "./session-tools";
import { gitTools } from "./git-tools";
import { folderTools } from "./folder-tools";
import { orchestratorTools } from "./orchestrator-tools";
import { metadataTools } from "./metadata-tools";
import { taskTools } from "./task-tools";
import { learningTools } from "./learning-tools";
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
 * - folder_get_children, folder_get_context
 * - preferences_get, preferences_set
 *
 * Orchestrator Tools:
 * - session_send_input, session_get_insights, orchestrator_status
 * - session_analyze, session_agent_info, project_metadata_detect
 *
 * Task Tools:
 * - task_submit, task_status, task_cancel, task_list
 * - project_knowledge_query
 *
 * Metadata Tools:
 * - project_metadata_get, project_metadata_enrich, project_metadata_detect
 * - project_metadata_list, project_metadata_refresh_stale
 *
 * Learning Tools:
 * - knowledge_add, knowledge_update, knowledge_delete
 */
export const allTools: RegisteredTool[] = [
  ...sessionTools,
  ...gitTools,
  ...folderTools,
  ...orchestratorTools,
  ...taskTools,
  ...metadataTools,
  ...learningTools,
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
