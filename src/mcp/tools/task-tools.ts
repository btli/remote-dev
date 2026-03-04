/**
 * Task Tools - Project Task Management
 *
 * Tools for creating and managing project tasks from AI agents.
 */
import { z } from "zod";
import { createTool } from "../registry.js";
import { successResult } from "../utils/error-handler.js";
import * as TaskService from "@/services/task-service";
import type { RegisteredTool } from "../types.js";

// Shared Zod schemas to stay in sync with TaskStatus/TaskPriority types
const taskStatusSchema = z.enum(["open", "in_progress", "done", "cancelled"]);
const taskPrioritySchema = z.enum(["critical", "high", "medium", "low"]);
const taskLabelSchema = z.object({
  name: z.string(),
  color: z.string().describe("Hex color without #"),
});

/**
 * task_list - List tasks for a folder
 */
const taskList = createTool({
  name: "task_list",
  description:
    "List project tasks, optionally filtered by folder. Returns tasks with priority, status, labels, and subtasks.",
  inputSchema: z.object({
    folderId: z
      .string()
      .uuid()
      .optional()
      .describe("Filter by folder ID. Omit to get all tasks."),
    status: taskStatusSchema
      .optional()
      .describe("Filter by task status"),
  }),
  handler: async (input, context) => {
    const tasks = await TaskService.getTasks(context.userId, input.folderId, input.status);

    return successResult({
      success: true,
      count: tasks.length,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        source: t.source,
        labels: t.labels,
        subtasks: t.subtasks,
        dueDate: t.dueDate?.toISOString() ?? null,
        githubIssueUrl: t.githubIssueUrl,
        folderId: t.folderId,
      })),
    });
  },
});

/**
 * task_create - Create a new task
 */
const taskCreate = createTool({
  name: "task_create",
  description:
    "Create a new project task. Agent-created tasks are automatically tagged with source='agent'.",
  inputSchema: z.object({
    title: z.string().min(1).describe("Task title"),
    folderId: z
      .string()
      .uuid()
      .optional()
      .describe("Folder to create the task in"),
    description: z.string().optional().describe("Task description"),
    priority: taskPrioritySchema
      .optional()
      .describe("Task priority (default: medium)"),
    labels: z
      .array(taskLabelSchema)
      .optional()
      .describe("Task labels"),
    dueDate: z
      .string()
      .optional()
      .describe("Due date as ISO 8601 string"),
  }),
  handler: async (input, context) => {
    const task = await TaskService.createTask(context.userId, {
      ...input,
      source: "agent",
    });

    return successResult({
      success: true,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        source: task.source,
        folderId: task.folderId,
      },
    });
  },
});

/**
 * task_update - Update an existing task
 */
const taskUpdate = createTool({
  name: "task_update",
  description: "Update a project task's properties.",
  inputSchema: z.object({
    taskId: z.string().uuid().describe("The task ID to update"),
    title: z.string().optional().describe("New task title"),
    description: z.string().optional().describe("New description"),
    status: taskStatusSchema
      .optional()
      .describe("New status"),
    priority: taskPrioritySchema
      .optional()
      .describe("New priority"),
    labels: z
      .array(taskLabelSchema)
      .optional()
      .describe("Replace all labels"),
    subtasks: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          completed: z.boolean(),
        })
      )
      .optional()
      .describe("Replace all subtasks"),
    dueDate: z.string().nullable().optional().describe("Due date (ISO 8601) or null to clear"),
  }),
  handler: async (input, context) => {
    const { taskId, ...updates } = input;
    const task = await TaskService.updateTask(taskId, context.userId, updates);

    if (!task) {
      return successResult({ success: false, error: "Task not found" });
    }

    return successResult({
      success: true,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
      },
    });
  },
});

/**
 * task_complete - Mark a task as done
 */
const taskComplete = createTool({
  name: "task_complete",
  description: "Mark a project task as done.",
  inputSchema: z.object({
    taskId: z.string().uuid().describe("The task ID to complete"),
  }),
  handler: async (input, context) => {
    const task = await TaskService.updateTask(
      input.taskId,
      context.userId,
      { status: "done" }
    );

    if (!task) {
      return successResult({ success: false, error: "Task not found" });
    }

    return successResult({
      success: true,
      task: { id: task.id, title: task.title, status: task.status },
    });
  },
});

/**
 * task_delete - Delete a task
 */
const taskDelete = createTool({
  name: "task_delete",
  description: "Permanently delete a project task.",
  inputSchema: z.object({
    taskId: z.string().uuid().describe("The task ID to delete"),
  }),
  handler: async (input, context) => {
    const deleted = await TaskService.deleteTask(input.taskId, context.userId);

    return successResult({
      success: deleted,
      ...(deleted ? {} : { error: "Task not found" }),
    });
  },
});

export const taskTools: RegisteredTool[] = [
  taskList,
  taskCreate,
  taskUpdate,
  taskComplete,
  taskDelete,
];
