import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import type { CreateSessionInput, SessionStatus } from "@/types/session";
import { resolve } from "path";

/**
 * Validate a project path to prevent path traversal attacks.
 * SECURITY: Ensures paths are within allowed directories.
 */
function validateProjectPath(path: string | undefined): string | undefined {
  if (!path) return undefined;

  // Must be absolute path
  if (!path.startsWith("/")) {
    return undefined;
  }

  // Resolve to canonical path (removes .., ., etc.)
  const resolved = resolve(path);

  // Must be within home directory or /tmp
  const home = process.env.HOME || "/tmp";
  if (!resolved.startsWith(home) && !resolved.startsWith("/tmp")) {
    return undefined;
  }

  return resolved;
}

/**
 * GET /api/sessions - List user's terminal sessions
 */
export const GET = withAuth(async (request, { userId }) => {
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
 */
export const POST = withAuth(async (request, { userId }) => {
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
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    // SECURITY: Validate projectPath to prevent path traversal
    const validatedPath = validateProjectPath(body.projectPath);
    if (body.projectPath && !validatedPath) {
      return errorResponse("Invalid project path", 400, "INVALID_PATH");
    }

    const input: CreateSessionInput = {
      name: body.name || "Terminal",
      projectPath: validatedPath,
      githubRepoId: body.githubRepoId,
      worktreeBranch: body.worktreeBranch,
      folderId: body.folderId,
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
