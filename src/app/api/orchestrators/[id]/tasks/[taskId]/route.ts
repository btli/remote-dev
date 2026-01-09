import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as TaskService from "@/services/task-service";

/**
 * GET /api/orchestrators/[id]/tasks/[taskId] - Get task details and status
 */
export const GET = withAuth(async (request, { userId, params }) => {
  try {
    const orchestratorId = params!.id;
    const taskId = params!.taskId;

    const task = await TaskService.getTask(orchestratorId, taskId, userId);

    if (!task) {
      return errorResponse("Task not found", 404, "TASK_NOT_FOUND");
    }

    // Get additional status info
    const response: Record<string, unknown> = {
      task: task.toPlainObject(),
      isActive: task.isActive(),
      isTerminal: task.isTerminal(),
      canCancel: task.canCancel(),
    };

    // Include delegation info if attached
    if (task.delegationId) {
      response.hasDelegation = true;
      response.delegationId = task.delegationId;
    }

    // Include beads issue info if linked
    if (task.beadsIssueId) {
      response.hasBeadsIssue = true;
      response.beadsIssueId = task.beadsIssueId;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error getting task:", error);

    if (error instanceof TaskService.TaskServiceError) {
      const status = error.code === "ORCHESTRATOR_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }

    return errorResponse("Failed to get task", 500);
  }
});

/**
 * PATCH /api/orchestrators/[id]/tasks/[taskId] - Update task
 *
 * Body:
 * - description?: Update task description (only for queued tasks)
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  try {
    const orchestratorId = params!.id;
    const taskId = params!.taskId;

    const result = await parseJsonBody<{
      description?: string;
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    if (body.description) {
      const task = await TaskService.updateTaskDescription(
        orchestratorId,
        taskId,
        userId,
        body.description
      );

      return NextResponse.json({ task: task.toPlainObject() });
    }

    return errorResponse("No valid update fields provided", 400, "NO_UPDATES");
  } catch (error) {
    console.error("Error updating task:", error);

    if (error instanceof TaskService.TaskServiceError) {
      const status = error.code === "TASK_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }

    return errorResponse("Failed to update task", 500);
  }
});

/**
 * DELETE /api/orchestrators/[id]/tasks/[taskId] - Cancel a task
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  try {
    const orchestratorId = params!.id;
    const taskId = params!.taskId;

    const task = await TaskService.cancelTask(orchestratorId, taskId, userId);

    return NextResponse.json({
      task: task.toPlainObject(),
      cancelled: true,
    });
  } catch (error) {
    console.error("Error cancelling task:", error);

    if (error instanceof TaskService.TaskServiceError) {
      if (error.code === "TASK_NOT_FOUND" || error.code === "ORCHESTRATOR_NOT_FOUND") {
        return errorResponse(error.message, 404, error.code);
      }
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to cancel task", 500);
  }
});
