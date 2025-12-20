import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as SessionService from "@/services/session-service";
import type { CreateSessionInput } from "@/types/session";

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
    const input: CreateSessionInput = {
      name: body.name || "Terminal",
      projectPath: body.projectPath,
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
