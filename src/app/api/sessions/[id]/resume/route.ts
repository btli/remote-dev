import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as SessionService from "@/services/session-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/sessions/:id/resume - Resume a suspended session
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await SessionService.resumeSession(id, session.user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error resuming session:", error);

    if (error instanceof SessionService.SessionServiceError) {
      let status = 400;
      if (error.code === "SESSION_NOT_FOUND") status = 404;
      if (error.code === "TMUX_SESSION_GONE") status = 410; // Gone

      return NextResponse.json(
        { error: error.message, code: error.code },
        { status }
      );
    }

    return NextResponse.json(
      { error: "Failed to resume session" },
      { status: 500 }
    );
  }
}
