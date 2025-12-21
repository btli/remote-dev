import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as SessionService from "@/services/session-service";
import type { CreateSessionInput } from "@/types/session";
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
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as "active" | "suspended" | "closed" | null;

    const sessions = await SessionService.listSessions(
      session.user.id,
      status ?? undefined
    );

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Error listing sessions:", error);
    return NextResponse.json(
      { error: "Failed to list sessions" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sessions - Create a new terminal session
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // SECURITY: Validate projectPath to prevent path traversal
    const validatedPath = validateProjectPath(body.projectPath);
    if (body.projectPath && !validatedPath) {
      return NextResponse.json(
        { error: "Invalid project path" },
        { status: 400 }
      );
    }

    const input: CreateSessionInput = {
      name: body.name || "Terminal",
      projectPath: validatedPath,
      githubRepoId: body.githubRepoId,
      worktreeBranch: body.worktreeBranch,
    };

    const newSession = await SessionService.createSession(session.user.id, input);

    return NextResponse.json(newSession, { status: 201 });
  } catch (error) {
    console.error("Error creating session:", error);

    if (error instanceof SessionService.SessionServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
