/**
 * Pure functions for agent task sync (no DB dependencies).
 *
 * Handles both legacy TodoWrite format and new TaskCreate/TaskUpdate format
 * from Claude Code v2.1.69+.
 */

import type { TaskStatus, TaskPriority } from "@/types/task";

/** PostToolUse hook stdin payload from Claude Code */
export interface PostToolUsePayload {
  tool_name: string;
  tool_input: Record<string, unknown>;
  [key: string]: unknown;
}

/** Parsed agent task operation */
export type AgentTaskOp =
  | {
      type: "create";
      agentTaskId: string;
      subject: string;
      description?: string;
      status: TaskStatus;
      priority?: TaskPriority;
      metadata?: Record<string, unknown>;
      owner?: string;
      blockedBy?: string[];
    }
  | {
      type: "update";
      agentTaskId: string;
      status?: TaskStatus;
      subject?: string;
      description?: string;
      priority?: TaskPriority;
      metadata?: Record<string, unknown>;
      owner?: string;
      blockedBy?: string[];
    };

const VALID_PRIORITIES = new Set<string>(["critical", "high", "medium", "low"]);

/** Map Claude Code task priority to remote-dev TaskPriority */
export function mapAgentTaskPriority(priority: string | undefined): TaskPriority | undefined {
  if (!priority) return undefined;
  const normalized = priority.toLowerCase();
  if (normalized === "urgent") return "critical"; // rdv CLI alias
  return VALID_PRIORITIES.has(normalized) ? (normalized as TaskPriority) : undefined;
}

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
 * Parse a PostToolUse hook payload into AgentTaskOp(s).
 *
 * Supports:
 * - TaskCreate: { subject, description?, activeForm?, metadata?, owner? }
 * - TaskUpdate: { taskId, status?, subject?, description?, metadata?, owner?, addBlockedBy? }
 * - Legacy TodoWrite: { todos: [{ id, content, status }] } (batch, returns multiple ops)
 */
export function parsePostToolUsePayload(payload: PostToolUsePayload): AgentTaskOp[] {
  const { tool_name, tool_input } = payload;

  if (tool_name === "TaskCreate") {
    const subject = tool_input.subject as string;
    if (!subject) return [];
    return [{
      type: "create",
      agentTaskId: stableId(subject),
      subject,
      description: tool_input.description as string | undefined,
      status: "open",
      priority: mapAgentTaskPriority(tool_input.priority as string | undefined),
      metadata: tool_input.metadata as Record<string, unknown> | undefined,
      owner: tool_input.owner as string | undefined,
      blockedBy: parseStringArray(tool_input.addBlockedBy),
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
    if (tool_input.description) {
      op.description = tool_input.description as string;
    }
    if (tool_input.priority) {
      op.priority = mapAgentTaskPriority(tool_input.priority as string);
    }
    if (tool_input.metadata) {
      op.metadata = tool_input.metadata as Record<string, unknown>;
    }
    if (tool_input.owner) {
      op.owner = tool_input.owner as string;
    }
    const blockedBy = parseStringArray(tool_input.addBlockedBy);
    if (blockedBy) {
      op.blockedBy = blockedBy;
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

/** Parse an optional array of strings from tool input */
function parseStringArray(value: unknown): string[] | undefined {
  if (!value || !Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
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
