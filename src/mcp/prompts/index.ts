/**
 * MCP Prompts Index
 *
 * Aggregates all prompts from workflow modules.
 */
import { workflowPrompts } from "./workflow-prompts.js";
import type { RegisteredPrompt } from "../types.js";

/**
 * All registered MCP prompts:
 *
 * Workflow Prompts:
 * - create_feature_session - Set up isolated feature development
 * - debug_session - Debug issues in a terminal session
 * - run_and_check - Execute command and analyze results
 * - setup_project - Configure complete project environment
 * - cleanup_worktrees - Review and clean up old worktrees
 */
export const allPrompts: RegisteredPrompt[] = [...workflowPrompts];

/**
 * Find a prompt by name
 */
export function findPrompt(name: string): RegisteredPrompt | undefined {
  return allPrompts.find((p) => p.name === name);
}

/**
 * List all prompt names
 */
export function listPromptNames(): string[] {
  return allPrompts.map((p) => p.name);
}
