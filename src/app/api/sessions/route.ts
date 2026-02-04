import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { validateProjectPath } from "@/lib/api-validation";
import * as SessionService from "@/services/session-service";
import type { CreateSessionInput, SessionStatus } from "@/types/session";

/**
 * GET /api/sessions - List user's terminal sessions
 *
 * Supports both session auth and API key auth for agent access.
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const statuses = statusParam
      ? statusParam
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    const status = statuses.length > 1
      ? (statuses as SessionStatus[])
      : (statuses[0] as SessionStatus | undefined);

    const sessions = await SessionService.listSessions(
      userId,
      status ?? undefined
    );

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Error listing sessions:", error);
    return errorResponse("Failed to list sessions", 500);
  }
});

/**
 * POST /api/sessions - Create a new terminal session
 *
 * Supports both session auth and API key auth for agent access.
 * Agents can create sessions with worktrees for issue workflows.
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      name?: string;
      projectPath?: string;
      githubRepoId?: string;
      worktreeBranch?: string;
      folderId?: string;
      startupCommand?: string;
      featureDescription?: string;
      createWorktree?: boolean;
      baseBranch?: string;
      terminalType?: "shell" | "agent" | "file";
      filePath?: string;
      profileId?: string;
      agentProvider?: string;
      autoLaunchAgent?: boolean;
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    // SECURITY: Validate projectPath to prevent path traversal
    const validatedPath = validateProjectPath(body.projectPath);
    if (body.projectPath && !validatedPath) {
      return errorResponse("Invalid project path", 400, "INVALID_PATH");
    }

    // SECURITY: Validate filePath to prevent path traversal
    const validatedFilePath = body.filePath ? validateProjectPath(body.filePath) : undefined;
    if (body.filePath && !validatedFilePath) {
      return errorResponse("Invalid file path", 400, "INVALID_FILE_PATH");
    }

    const input: CreateSessionInput = {
      name: body.name || "Terminal",
      projectPath: validatedPath,
      githubRepoId: body.githubRepoId,
      worktreeBranch: body.worktreeBranch,
      folderId: body.folderId,
      // Terminal type (shell, agent, file)
      terminalType: body.terminalType,
      filePath: validatedFilePath,
      profileId: body.profileId,
      agentProvider: body.agentProvider as CreateSessionInput["agentProvider"],
      autoLaunchAgent: body.autoLaunchAgent,
      // Feature session fields
      startupCommand: body.startupCommand,
      featureDescription: body.featureDescription,
      createWorktree: body.createWorktree,
      baseBranch: body.baseBranch,
    };

    const newSession = await SessionService.createSession(userId, input);

    return NextResponse.json(newSession, { status: 201 });
  } catch (error) {
    console.error("Error creating session:", error);

    if (error instanceof SessionService.SessionServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to create session", 500);
  }
});
