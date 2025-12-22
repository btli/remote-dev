import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import type { CreateSessionInput } from "@/types/session";

/**
 * GET /api/sessions - List user's terminal sessions
 */
export const GET = withAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as "active" | "suspended" | "closed" | null;

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
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      name?: string;
      projectPath?: string;
      githubRepoId?: string;
      worktreeBranch?: string;
    }>(request);
    if ("error" in result) return result.error;

    const input: CreateSessionInput = {
      name: result.data.name || "Terminal",
      projectPath: result.data.projectPath,
      githubRepoId: result.data.githubRepoId,
      worktreeBranch: result.data.worktreeBranch,
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
