import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as TaskService from "@/services/task-service";

/**
 * GET /api/orchestrators/[id]/tasks - List tasks for an orchestrator
 *
 * Query parameters:
 * - status: Filter by status (comma-separated, e.g., "queued,planning")
 * - limit: Maximum number of results (default: 50)
 * - offset: Offset for pagination (default: 0)
 */
export const GET = withAuth(async (request, { userId, params }) => {
  try {
    const orchestratorId = params!.id;
    const url = new URL(request.url);

    // Parse query parameters
    const statusParam = url.searchParams.get("status");
    const status = statusParam ? statusParam.split(",").filter(Boolean) : undefined;
    const limit = url.searchParams.get("limit")
      ? parseInt(url.searchParams.get("limit")!, 10)
      : 50;
    const offset = url.searchParams.get("offset")
      ? parseInt(url.searchParams.get("offset")!, 10)
      : 0;

    const result = await TaskService.listTasks(orchestratorId, userId, {
      status,
      limit,
      offset,
    });

    return NextResponse.json({
      tasks: result.tasks.map((task) => task.toPlainObject()),
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error listing tasks:", error);

    if (error instanceof TaskService.TaskServiceError) {
      const status = error.code === "ORCHESTRATOR_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }

    return errorResponse("Failed to list tasks", 500);
  }
});

/**
 * POST /api/orchestrators/[id]/tasks - Submit a new task
 *
 * Body:
 * - input: Natural language task description (for parsing)
 * - OR description + type: Direct task creation
 * - folderId?: Optional folder scope
 * - beadsIssueId?: Optional beads issue link
 */
export const POST = withAuth(async (request, { userId, params }) => {
  try {
    const orchestratorId = params!.id;

    const result = await parseJsonBody<{
      input?: string;
      description?: string;
      type?: string;
      folderId?: string;
      beadsIssueId?: string;
      confidence?: number;
      estimatedDuration?: number;
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    // Validate input - either natural language or direct creation
    if (body.input) {
      // Natural language parsing
      const { task, parsedInfo } = await TaskService.submitTask(
        orchestratorId,
        userId,
        body.input,
        {
          folderId: body.folderId,
          beadsIssueId: body.beadsIssueId,
        }
      );

      return NextResponse.json(
        {
          task: task.toPlainObject(),
          parsedInfo: {
            description: parsedInfo.description,
            type: parsedInfo.type.toString(),
            confidence: parsedInfo.confidence,
            reasoning: parsedInfo.reasoning,
            suggestedAgents: parsedInfo.suggestedAgents,
            estimatedDuration: parsedInfo.estimatedDuration,
          },
        },
        { status: 201 }
      );
    } else if (body.description && body.type) {
      // Direct task creation
      const task = await TaskService.createTask(orchestratorId, userId, {
        description: body.description,
        type: body.type,
        folderId: body.folderId,
        confidence: body.confidence,
        estimatedDuration: body.estimatedDuration,
        beadsIssueId: body.beadsIssueId,
      });

      return NextResponse.json({ task: task.toPlainObject() }, { status: 201 });
    } else {
      return errorResponse(
        "Either 'input' (for natural language) or 'description' and 'type' (for direct creation) are required",
        400,
        "INVALID_INPUT"
      );
    }
  } catch (error) {
    console.error("Error submitting task:", error);

    if (error instanceof TaskService.TaskServiceError) {
      const status = error.code === "ORCHESTRATOR_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }

    return errorResponse("Failed to submit task", 500);
  }
});
