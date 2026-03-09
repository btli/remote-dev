/**
 * Pure functions for stop-hook message formatting (no DB dependencies).
 *
 * Builds the message that the Stop hook returns to the agent, instructing it
 * to add incomplete tasks to its native task list via TaskCreate.
 */

import type { ProjectTask } from "@/types/task";

/** Marker prefix for auto-appended post-tasks (Code Simplifier, Code Review) */
export const POST_TASK_MARKER_PREFIX = "post-task:";

/** Post-task configuration: titles and their slash commands */
export const POST_TASK_CONFIG = [
  { title: "Code Simplifier", command: "/simplify" },
  { title: "Code Review", command: "/code-review" },
] as const;

/** Lookup from post-task title to slash command */
const POST_TASK_COMMANDS: Record<string, string> = Object.fromEntries(
  POST_TASK_CONFIG.map((t) => [t.title, t.command])
);

/** Pre-computed example commands for the stop-hook footer */
const EXAMPLE_POST_COMMANDS = POST_TASK_CONFIG.map((t) => t.command).join(", ");

/** Discriminated union for task classification in stop-hook messages */
export type TaskCategory =
  | { kind: "post-task"; command: string | null }
  | { kind: "user-assigned" }
  | { kind: "agent-owned" };

/** Classify a task for stop-hook message formatting */
export function classifyTask(task: ProjectTask): TaskCategory {
  if (task.description?.startsWith(POST_TASK_MARKER_PREFIX)) {
    const command = POST_TASK_COMMANDS[task.title] ?? null;
    return { kind: "post-task", command };
  }
  if (task.source === "manual") {
    return { kind: "user-assigned" };
  }
  return { kind: "agent-owned" };
}

/**
 * Build the stop-hook message instructing the agent to add incomplete tasks
 * to its native task list via TaskCreate, then complete them.
 */
export function buildStopMessage(incomplete: ProjectTask[]): string {
  const lines: string[] = [
    `You have ${incomplete.length} incomplete task(s) that must be completed before stopping.`,
    "",
    "Add each task below to your task list using TaskCreate, then complete them:",
    "",
  ];

  let hasPostTask = false;

  for (const task of incomplete) {
    const category = classifyTask(task);
    const priorityNote = task.priority !== "medium" ? ` [${task.priority}]` : "";

    if (category.kind === "post-task") {
      hasPostTask = true;
      const cmd = category.command ? ` — run ${category.command}` : "";
      lines.push(`- ${task.title}${priorityNote}${cmd}`);
    } else {
      const sourceNote = category.kind === "user-assigned" ? " (user-assigned)" : "";
      lines.push(`- ${task.title}${priorityNote}${sourceNote}`);
    }
  }

  lines.push(
    "",
    "For each task: use TaskCreate to add it to your task list, complete the work, then mark done with TaskUpdate.",
  );

  if (hasPostTask) {
    lines.push(`For post-tasks: run the slash command listed above (e.g. ${EXAMPLE_POST_COMMANDS}).`);
  }

  return lines.join("\n");
}
