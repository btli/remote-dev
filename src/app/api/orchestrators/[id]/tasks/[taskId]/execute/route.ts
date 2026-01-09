import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as TaskService from "@/services/task-service";
import type { AgentProviderType } from "@/types/session";

/**
 * POST /api/orchestrators/[id]/tasks/[taskId]/execute - Plan and/or execute a task
 *
 * This endpoint has two modes:
 * 1. Plan mode (action: "plan"): Transitions task from queued to planning and returns execution plan
 * 2. Execute mode (action: "execute"): Confirms execution with a previously generated plan
 *
 * Body for plan mode:
 * - action: "plan"
 * - folderPath: Working directory path
 * - availableAgents?: List of available agents
 * - gitStatus?: Current git status
 *
 * Body for execute mode:
 * - action: "execute"
 * - plan: The execution plan to use
 */
export const POST = withAuth(async (request, { userId, params }) => {
  try {
    const orchestratorId = params!.id;
    const taskId = params!.taskId;

    const result = await parseJsonBody<{
      action: "plan" | "execute";
      // Plan mode fields
      folderPath?: string;
      availableAgents?: AgentProviderType[];
      gitStatus?: string;
      // Execute mode fields
      plan?: {
        taskId: string;
        selectedAgent: AgentProviderType;
        isolationStrategy: "worktree" | "branch" | "none";
        worktreePath?: string;
        branchName?: string;
        contextToInject: string;
        estimatedTokens: number;
        reasoning: string;
      };
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    if (body.action === "plan") {
      // Plan mode: Generate execution plan
      if (!body.folderPath) {
        return errorResponse("folderPath is required for plan action", 400, "MISSING_FOLDER_PATH");
      }

      const { task, plan } = await TaskService.planTask(
        orchestratorId,
        taskId,
        userId,
        {
          folderPath: body.folderPath,
          availableAgents: body.availableAgents,
          gitStatus: body.gitStatus,
        }
      );

      return NextResponse.json({
        task: task.toPlainObject(),
        plan: {
          taskId: plan.taskId,
          selectedAgent: plan.selectedAgent,
          isolationStrategy: plan.isolationStrategy,
          worktreePath: plan.worktreePath,
          branchName: plan.branchName,
          contextToInject: plan.contextToInject,
          estimatedTokens: plan.estimatedTokens,
          reasoning: plan.reasoning,
        },
        status: "planned",
      });
    } else if (body.action === "execute") {
      // Execute mode: Confirm and start execution
      if (!body.plan) {
        return errorResponse("plan is required for execute action", 400, "MISSING_PLAN");
      }

      const task = await TaskService.confirmExecution(
        orchestratorId,
        taskId,
        userId,
        body.plan
      );

      return NextResponse.json({
        task: task.toPlainObject(),
        status: "executing",
      });
    } else {
      return errorResponse(
        "action must be 'plan' or 'execute'",
        400,
        "INVALID_ACTION"
      );
    }
  } catch (error) {
    console.error("Error executing task:", error);

    if (error instanceof TaskService.TaskServiceError) {
      if (error.code === "TASK_NOT_FOUND" || error.code === "ORCHESTRATOR_NOT_FOUND") {
        return errorResponse(error.message, 404, error.code);
      }
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to execute task", 500);
  }
});
