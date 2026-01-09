/**
 * Task Tools - Task Management for Orchestrator
 *
 * MCP tools for submitting, monitoring, and managing tasks through the orchestrator.
 * Enables AI agents to coordinate task workflows and monitor execution.
 */
import { z } from "zod";
import { createTool } from "../registry";
import { successResult } from "../utils/error-handler";
import { db } from "@/db";
import {
  orchestratorSessions,
  tasks,
  delegations,
  projectKnowledge,
  sessionFolders,
} from "@/db/schema";
import { eq, desc, and, like, or } from "drizzle-orm";
import type { RegisteredTool } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// task_submit - Submit a new task to the orchestrator
// ─────────────────────────────────────────────────────────────────────────────

const taskSubmit = createTool({
  name: "task_submit",
  description:
    "Submit a new task to the orchestrator for planning and execution. " +
    "The orchestrator will parse the natural language input, determine task type, " +
    "and optionally plan/execute based on the autonomy level.",
  inputSchema: z.object({
    orchestratorId: z.string().uuid().describe("The orchestrator UUID to submit task to"),
    input: z.string().min(1).describe("Natural language description of the task"),
    folderId: z.string().uuid().optional().describe("Optional folder context for the task"),
    beadsIssueId: z
      .string()
      .optional()
      .describe("Optional beads issue ID to link this task to"),
  }),
  handler: async (input, context) => {
    // Verify orchestrator exists and belongs to user
    const orchestrator = await db
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.id, input.orchestratorId),
          eq(orchestratorSessions.userId, context.userId)
        )
      )
      .limit(1);

    if (orchestrator.length === 0) {
      return successResult({
        success: false,
        error: "Orchestrator not found or access denied",
        code: "ORCHESTRATOR_NOT_FOUND",
      });
    }

    // Create the task
    const taskId = crypto.randomUUID();
    const now = new Date();

    await db.insert(tasks).values({
      id: taskId,
      orchestratorId: input.orchestratorId,
      userId: context.userId,
      folderId: input.folderId || null,
      description: input.input,
      type: "feature", // Default type, orchestrator will refine
      status: "queued",
      beadsIssueId: input.beadsIssueId || null,
      createdAt: now,
      updatedAt: now,
    });

    return successResult({
      success: true,
      taskId,
      status: "queued",
      orchestratorId: input.orchestratorId,
      description: input.input,
      createdAt: now.toISOString(),
      hint: "Task queued successfully. Use task_status to monitor progress.",
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// task_status - Get task status and progress
// ─────────────────────────────────────────────────────────────────────────────

const taskStatus = createTool({
  name: "task_status",
  description:
    "Get the current status and progress of a task. " +
    "Includes execution details, delegation status, and any errors.",
  inputSchema: z.object({
    taskId: z.string().uuid().describe("The task UUID to query"),
    includeDelegations: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include delegation details (default: true)"),
  }),
  handler: async (input, context) => {
    // Get task with orchestrator ownership check
    const taskData = await db
      .select({
        task: tasks,
        orchestrator: orchestratorSessions,
      })
      .from(tasks)
      .innerJoin(orchestratorSessions, eq(tasks.orchestratorId, orchestratorSessions.id))
      .where(
        and(eq(tasks.id, input.taskId), eq(orchestratorSessions.userId, context.userId))
      )
      .limit(1);

    if (taskData.length === 0) {
      return successResult({
        success: false,
        error: "Task not found or access denied",
        code: "TASK_NOT_FOUND",
      });
    }

    const task = taskData[0].task;

    // Get delegations if requested
    let taskDelegations: {
      id: string;
      agentType: string;
      status: string;
      startedAt: Date | null;
      completedAt: Date | null;
    }[] = [];

    if (input.includeDelegations) {
      const delegationData = await db
        .select({
          id: delegations.id,
          agentProvider: delegations.agentProvider,
          status: delegations.status,
          createdAt: delegations.createdAt,
          completedAt: delegations.completedAt,
        })
        .from(delegations)
        .where(eq(delegations.taskId, input.taskId))
        .orderBy(desc(delegations.createdAt));

      taskDelegations = delegationData.map((d) => ({
        id: d.id,
        agentType: d.agentProvider,
        status: d.status,
        startedAt: d.createdAt,
        completedAt: d.completedAt,
      }));
    }

    // Parse result JSON if present
    let result = null;
    if (task.resultJson) {
      try {
        result = JSON.parse(task.resultJson);
      } catch {
        result = null;
      }
    }

    // Parse error JSON if present
    let error = null;
    if (task.errorJson) {
      try {
        error = JSON.parse(task.errorJson);
      } catch {
        error = null;
      }
    }

    return successResult({
      success: true,
      task: {
        id: task.id,
        orchestratorId: task.orchestratorId,
        description: task.description,
        type: task.type,
        status: task.status,
        assignedAgent: task.assignedAgent,
        result,
        error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
      },
      delegations: taskDelegations,
      hint: getStatusHint(task.status),
    });
  },
});

/**
 * Get helpful hint based on task status
 */
function getStatusHint(status: string): string {
  switch (status) {
    case "queued":
      return "Task is waiting to be processed. Orchestrator will plan execution soon.";
    case "planning":
      return "Orchestrator is analyzing the task and planning execution.";
    case "executing":
      return "Task is being executed by an agent.";
    case "monitoring":
      return "Execution complete. Orchestrator is monitoring for verification.";
    case "completed":
      return "Task completed successfully.";
    case "failed":
      return "Task failed. Check error details for more information.";
    case "cancelled":
      return "Task was cancelled.";
    default:
      return "Unknown status.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// task_cancel - Cancel a running or queued task
// ─────────────────────────────────────────────────────────────────────────────

const taskCancel = createTool({
  name: "task_cancel",
  description:
    "Cancel a queued or running task. " +
    "Stops any active delegations and marks the task as cancelled.",
  inputSchema: z.object({
    taskId: z.string().uuid().describe("The task UUID to cancel"),
    reason: z.string().optional().describe("Reason for cancellation"),
  }),
  handler: async (input, context) => {
    // Get task with orchestrator ownership check
    const taskData = await db
      .select({
        task: tasks,
        orchestrator: orchestratorSessions,
      })
      .from(tasks)
      .innerJoin(orchestratorSessions, eq(tasks.orchestratorId, orchestratorSessions.id))
      .where(
        and(eq(tasks.id, input.taskId), eq(orchestratorSessions.userId, context.userId))
      )
      .limit(1);

    if (taskData.length === 0) {
      return successResult({
        success: false,
        error: "Task not found or access denied",
        code: "TASK_NOT_FOUND",
      });
    }

    const task = taskData[0].task;

    // Check if task can be cancelled
    if (task.status === "completed" || task.status === "cancelled") {
      return successResult({
        success: false,
        error: `Cannot cancel task in ${task.status} status`,
        code: "INVALID_STATUS",
      });
    }

    const now = new Date();

    // Update task status
    await db
      .update(tasks)
      .set({
        status: "cancelled",
        updatedAt: now,
        completedAt: now,
        errorJson: JSON.stringify({
          code: "CANCELLED",
          message: input.reason || "Task cancelled by user",
        }),
      })
      .where(eq(tasks.id, input.taskId));

    // Cancel any active delegations (set to failed since there's no cancelled status)
    await db
      .update(delegations)
      .set({
        status: "failed",
        completedAt: now,
        errorJson: JSON.stringify({
          code: "CANCELLED",
          message: input.reason || "Task cancelled by user",
        }),
      })
      .where(
        and(
          eq(delegations.taskId, input.taskId),
          or(eq(delegations.status, "running"), eq(delegations.status, "monitoring"))
        )
      );

    return successResult({
      success: true,
      taskId: input.taskId,
      previousStatus: task.status,
      newStatus: "cancelled",
      reason: input.reason || "Cancelled by user",
      hint: "Task and any active delegations have been cancelled.",
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// task_list - List tasks for an orchestrator
// ─────────────────────────────────────────────────────────────────────────────

const taskList = createTool({
  name: "task_list",
  description:
    "List all tasks for an orchestrator with optional filtering. " +
    "Returns tasks sorted by creation date (newest first).",
  inputSchema: z.object({
    orchestratorId: z.string().uuid().describe("The orchestrator UUID to list tasks for"),
    status: z
      .enum(["queued", "planning", "executing", "monitoring", "completed", "failed", "cancelled"])
      .optional()
      .describe("Filter by status (optional)"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(50)
      .describe("Maximum number of tasks to return (default: 50)"),
    includeCompleted: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include completed/failed/cancelled tasks (default: true)"),
  }),
  handler: async (input, context) => {
    // Verify orchestrator exists and belongs to user
    const orchestrator = await db
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.id, input.orchestratorId),
          eq(orchestratorSessions.userId, context.userId)
        )
      )
      .limit(1);

    if (orchestrator.length === 0) {
      return successResult({
        success: false,
        error: "Orchestrator not found or access denied",
        code: "ORCHESTRATOR_NOT_FOUND",
      });
    }

    // Build query
    let query = db
      .select()
      .from(tasks)
      .where(eq(tasks.orchestratorId, input.orchestratorId))
      .orderBy(desc(tasks.createdAt))
      .limit(input.limit);

    // Apply status filter
    if (input.status) {
      query = db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.orchestratorId, input.orchestratorId),
            eq(tasks.status, input.status)
          )
        )
        .orderBy(desc(tasks.createdAt))
        .limit(input.limit);
    } else if (!input.includeCompleted) {
      // Exclude completed/failed/cancelled
      query = db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.orchestratorId, input.orchestratorId),
            or(
              eq(tasks.status, "queued"),
              eq(tasks.status, "planning"),
              eq(tasks.status, "executing"),
              eq(tasks.status, "monitoring")
            )
          )
        )
        .orderBy(desc(tasks.createdAt))
        .limit(input.limit);
    }

    const taskList = await query;

    // Count by status
    const statusCounts = taskList.reduce(
      (acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return successResult({
      success: true,
      orchestratorId: input.orchestratorId,
      count: taskList.length,
      statusCounts,
      tasks: taskList.map((t) => ({
        id: t.id,
        description: t.description,
        type: t.type,
        status: t.status,
        assignedAgent: t.assignedAgent,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        completedAt: t.completedAt,
      })),
      hint:
        taskList.length === 0
          ? "No tasks found. Use task_submit to create a new task."
          : `Found ${taskList.length} task(s).`,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// project_knowledge_query - Query project knowledge base
// ─────────────────────────────────────────────────────────────────────────────

const projectKnowledgeQuery = createTool({
  name: "project_knowledge_query",
  description:
    "Query the project knowledge base for conventions, patterns, skills, and tools. " +
    "Use this to understand project context and best practices.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("The folder UUID to query knowledge for"),
    query: z.string().optional().describe("Search query for filtering knowledge"),
    type: z
      .enum(["all", "conventions", "patterns", "skills", "tools", "tech_stack"])
      .optional()
      .default("all")
      .describe("Type of knowledge to query (default: all)"),
  }),
  handler: async (input, context) => {
    // Verify folder exists and belongs to user
    const folder = await db
      .select()
      .from(sessionFolders)
      .where(
        and(
          eq(sessionFolders.id, input.folderId),
          eq(sessionFolders.userId, context.userId)
        )
      )
      .limit(1);

    if (folder.length === 0) {
      return successResult({
        success: false,
        error: "Folder not found or access denied",
        code: "FOLDER_NOT_FOUND",
      });
    }

    // Get project knowledge for the folder
    const knowledge = await db
      .select()
      .from(projectKnowledge)
      .where(eq(projectKnowledge.folderId, input.folderId))
      .limit(1);

    if (knowledge.length === 0) {
      return successResult({
        success: true,
        exists: false,
        folderId: input.folderId,
        folderName: folder[0].name,
        hint: "No project knowledge found for this folder. Run a project scan to gather knowledge.",
      });
    }

    const knowledgeData = knowledge[0];

    // Parse stored JSON fields
    let techStack: string[] = [];
    let conventions: unknown[] = [];
    let patterns: unknown[] = [];
    let skills: unknown[] = [];
    let tools: unknown[] = [];
    let metadata: { projectName?: string } = {};

    try {
      if (knowledgeData.techStackJson) {
        techStack = JSON.parse(knowledgeData.techStackJson);
      }
      if (knowledgeData.conventionsJson) {
        conventions = JSON.parse(knowledgeData.conventionsJson);
      }
      if (knowledgeData.patternsJson) {
        patterns = JSON.parse(knowledgeData.patternsJson);
      }
      if (knowledgeData.skillsJson) {
        skills = JSON.parse(knowledgeData.skillsJson);
      }
      if (knowledgeData.toolsJson) {
        tools = JSON.parse(knowledgeData.toolsJson);
      }
      if (knowledgeData.metadataJson) {
        metadata = JSON.parse(knowledgeData.metadataJson);
      }
    } catch {
      // Parsing errors - return empty
    }

    // Apply search query if provided
    if (input.query) {
      const q = input.query.toLowerCase();

      conventions = (conventions as { description?: string }[]).filter(
        (c) => c.description?.toLowerCase().includes(q)
      );
      patterns = (patterns as { description?: string }[]).filter(
        (p) => p.description?.toLowerCase().includes(q)
      );
      skills = (skills as { name?: string; description?: string }[]).filter(
        (s) => s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)
      );
      tools = (tools as { name?: string; description?: string }[]).filter(
        (t) => t.name?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)
      );
      techStack = techStack.filter((t) => t.toLowerCase().includes(q));
    }

    // Filter by type
    const result: {
      techStack?: string[];
      conventions?: unknown[];
      patterns?: unknown[];
      skills?: unknown[];
      tools?: unknown[];
    } = {};

    if (input.type === "all" || input.type === "tech_stack") {
      result.techStack = techStack;
    }
    if (input.type === "all" || input.type === "conventions") {
      result.conventions = conventions;
    }
    if (input.type === "all" || input.type === "patterns") {
      result.patterns = patterns;
    }
    if (input.type === "all" || input.type === "skills") {
      result.skills = skills;
    }
    if (input.type === "all" || input.type === "tools") {
      result.tools = tools;
    }

    return successResult({
      success: true,
      exists: true,
      folderId: input.folderId,
      folderName: folder[0].name,
      projectName: metadata.projectName || null,
      query: input.query,
      type: input.type,
      knowledge: result,
      counts: {
        techStack: techStack.length,
        conventions: conventions.length,
        patterns: patterns.length,
        skills: skills.length,
        tools: tools.length,
      },
      lastScannedAt: knowledgeData.updatedAt,
      hint: input.query
        ? `Found matching knowledge for "${input.query}".`
        : "Project knowledge retrieved successfully.",
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Export all task tools
// ─────────────────────────────────────────────────────────────────────────────

export const taskTools: RegisteredTool[] = [
  taskSubmit,
  taskStatus,
  taskCancel,
  taskList,
  projectKnowledgeQuery,
];
