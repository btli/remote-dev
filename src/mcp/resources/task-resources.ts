/**
 * Task Resources - Read-only access to task and knowledge data
 *
 * MCP resources provide read access to application data.
 * Resources use URI patterns like rdv://tasks/{id}
 */
import { createResource, extractUriParams } from "../registry";
import { db } from "@/db";
import {
  tasks,
  delegations,
  projectKnowledge,
  sessionFolders,
  orchestratorSessions,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { RegisteredResource } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// rdv://tasks/{id} - Get task details
// ─────────────────────────────────────────────────────────────────────────────

const taskDetailResource = createResource({
  uri: "rdv://tasks/{id}",
  name: "Task Details",
  description:
    "Get detailed information about a specific task including status, " +
    "result, delegations, and execution history.",
  mimeType: "application/json",
  handler: async (uri, context) => {
    const params = extractUriParams("rdv://tasks/{id}", uri);
    const taskId = params.id;

    // Get task with orchestrator ownership check
    const taskData = await db
      .select({
        task: tasks,
        orchestrator: orchestratorSessions,
      })
      .from(tasks)
      .innerJoin(orchestratorSessions, eq(tasks.orchestratorId, orchestratorSessions.id))
      .where(
        and(eq(tasks.id, taskId), eq(orchestratorSessions.userId, context.userId))
      )
      .limit(1);

    if (taskData.length === 0) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          error: "Task not found",
          code: "TASK_NOT_FOUND",
        }),
      };
    }

    const task = taskData[0].task;

    // Get delegations for this task
    const taskDelegations = await db
      .select()
      .from(delegations)
      .where(eq(delegations.taskId, taskId))
      .orderBy(desc(delegations.createdAt));

    // Parse JSON fields
    let result = null;
    let error = null;

    try {
      if (task.resultJson) {
        result = JSON.parse(task.resultJson);
      }
    } catch {
      // Ignore parse errors
    }

    try {
      if (task.errorJson) {
        error = JSON.parse(task.errorJson);
      }
    } catch {
      // Ignore parse errors
    }

    const data = {
      id: task.id,
      orchestratorId: task.orchestratorId,
      folderId: task.folderId,
      description: task.description,
      type: task.type,
      status: task.status,
      assignedAgent: task.assignedAgent,
      beadsIssueId: task.beadsIssueId,
      result,
      error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      delegations: taskDelegations.map((d) => ({
        id: d.id,
        sessionId: d.sessionId,
        agentProvider: d.agentProvider,
        status: d.status,
        worktreeId: d.worktreeId,
        createdAt: d.createdAt,
        completedAt: d.completedAt,
      })),
    };

    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// rdv://orchestrators/{id}/knowledge - Get project knowledge
// ─────────────────────────────────────────────────────────────────────────────

const orchestratorKnowledgeResource = createResource({
  uri: "rdv://orchestrators/{id}/knowledge",
  name: "Orchestrator Project Knowledge",
  description:
    "Get the project knowledge base for an orchestrator's scope. " +
    "Includes tech stack, conventions, patterns, skills, and tools.",
  mimeType: "application/json",
  handler: async (uri, context) => {
    const params = extractUriParams("rdv://orchestrators/{id}/knowledge", uri);
    const orchestratorId = params.id;

    // Get orchestrator with ownership check
    const orchestrator = await db
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.id, orchestratorId),
          eq(orchestratorSessions.userId, context.userId)
        )
      )
      .limit(1);

    if (orchestrator.length === 0) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          error: "Orchestrator not found",
          code: "ORCHESTRATOR_NOT_FOUND",
        }),
      };
    }

    const orc = orchestrator[0];

    // Get folder ID from orchestrator scope
    let folderId: string | null = null;

    if (orc.scopeType === "folder" && orc.scopeId) {
      folderId = orc.scopeId;
    } else if (orc.scopeType === "global") {
      // For Master Control, we don't have a specific folder
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          orchestratorId,
          orchestratorType: orc.type,
          scopeType: orc.scopeType,
          knowledge: null,
          hint: "Master Control does not have folder-specific knowledge. Query a folder directly.",
        }),
      };
    }

    if (!folderId) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          error: "No folder scope for orchestrator",
          code: "NO_FOLDER_SCOPE",
        }),
      };
    }

    // Get folder info
    const folder = await db
      .select()
      .from(sessionFolders)
      .where(eq(sessionFolders.id, folderId))
      .limit(1);

    // Get project knowledge
    const knowledge = await db
      .select()
      .from(projectKnowledge)
      .where(eq(projectKnowledge.folderId, folderId))
      .limit(1);

    if (knowledge.length === 0) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          orchestratorId,
          orchestratorType: orc.type,
          folderId,
          folderName: folder[0]?.name || "Unknown",
          exists: false,
          hint: "No project knowledge found. Run a project scan to gather knowledge.",
        }),
      };
    }

    const k = knowledge[0];

    // Parse JSON fields
    let techStack: string[] = [];
    let conventions: unknown[] = [];
    let patterns: unknown[] = [];
    let skills: unknown[] = [];
    let tools: unknown[] = [];
    let metadata: { projectName?: string } = {};

    try {
      if (k.techStackJson) techStack = JSON.parse(k.techStackJson);
      if (k.conventionsJson) conventions = JSON.parse(k.conventionsJson);
      if (k.patternsJson) patterns = JSON.parse(k.patternsJson);
      if (k.skillsJson) skills = JSON.parse(k.skillsJson);
      if (k.toolsJson) tools = JSON.parse(k.toolsJson);
      if (k.metadataJson) metadata = JSON.parse(k.metadataJson);
    } catch {
      // Ignore parse errors
    }

    const data = {
      orchestratorId,
      orchestratorType: orc.type,
      folderId,
      folderName: folder[0]?.name || "Unknown",
      exists: true,
      projectName: metadata.projectName || null,
      knowledge: {
        techStack,
        conventions,
        patterns,
        skills,
        tools,
      },
      counts: {
        techStack: techStack.length,
        conventions: conventions.length,
        patterns: patterns.length,
        skills: skills.length,
        tools: tools.length,
      },
      lastScannedAt: k.updatedAt,
    };

    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Export all task resources
// ─────────────────────────────────────────────────────────────────────────────

export const taskResources: RegisteredResource[] = [
  taskDetailResource,
  orchestratorKnowledgeResource,
];
