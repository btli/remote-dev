import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as SessionService from "@/services/session-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/sessions/:id/suspend - Suspend a session (detach tmux)
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await SessionService.suspendSession(id, session.user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error suspending session:", error);

    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status }
      );
    }

    return NextResponse.json(
      { error: "Failed to suspend session" },
      { status: 500 }
    );
  }
}
