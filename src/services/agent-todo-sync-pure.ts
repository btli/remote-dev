/**
 * Pure functions for agent task sync (no DB dependencies).
 *
 * Handles both legacy TodoWrite format and new TaskCreate/TaskUpdate format
 * from Claude Code v2.1.69+.
 */

import type { TaskStatus } from "@/types/task";

/** PostToolUse hook stdin payload from Claude Code */
export interface PostToolUsePayload {
  tool_name: string;
  tool_input: Record<string, unknown>;
  [key: string]: unknown;
}

/** Parsed agent task operation */
export type AgentTaskOp =
  | { type: "create"; agentTaskId: string; subject: string; description?: string; status: TaskStatus }
  | { type: "update"; agentTaskId: string; status?: TaskStatus; subject?: string };

/** Map Claude Code task status to remote-dev TaskStatus */
export function mapAgentTaskStatus(status: string): TaskStatus {
  switch (status) {
    case "in_progress":
      return "in_progress";
    case "completed":
      return "done";
    case "pending":
    default:
      return "open";
  }
}

/**
 * Parse a PostToolUse hook payload into an AgentTaskOp.
 *
 * Supports:
 * - TaskCreate: { subject, description?, activeForm? }
 * - TaskUpdate: { taskId, status?, addBlockedBy? }
 * - Legacy TodoWrite: { todos: [{ id, content, status }] } (batch, returns multiple ops)
 */
export function parsePostToolUsePayload(payload: PostToolUsePayload): AgentTaskOp[] {
  const { tool_name, tool_input } = payload;

  if (tool_name === "TaskCreate") {
    const subject = tool_input.subject as string;
    if (!subject) return [];
    // Use a counter-based ID that we'll resolve on the server side
    // The agent uses sequential IDs like "1", "2", etc. but we don't have access here
    // Instead, we'll use a hash of the subject as a stable identifier
    return [{
      type: "create",
      agentTaskId: stableId(subject),
      subject,
      description: tool_input.description as string | undefined,
      status: "open",
    }];
  }

  if (tool_name === "TaskUpdate") {
    const taskId = tool_input.taskId as string;
    if (!taskId) return [];
    const op: AgentTaskOp = { type: "update", agentTaskId: taskId };
    if (tool_input.status) {
      op.status = mapAgentTaskStatus(tool_input.status as string);
    }
    if (tool_input.subject) {
      op.subject = tool_input.subject as string;
    }
    return [op];
  }

  // Legacy TodoWrite support
  if (tool_name === "TodoWrite") {
    const todos = tool_input.todos as Array<{ id: string; content: string; status: string }> | undefined;
    if (!todos || !Array.isArray(todos)) return [];
    return todos.map((todo) => ({
      type: "create" as const,
      agentTaskId: todo.id,
      subject: todo.content,
      status: mapAgentTaskStatus(todo.status),
    }));
  }

  return [];
}

/** Create a stable short ID from a string (for dedup) */
function stableId(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return `cc-${Math.abs(hash).toString(36)}`;
}
