import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import * as SessionService from "@/services/session-service";

/**
 * POST /api/sessions/reorder - Reorder sessions (update tab order)
 */
export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { sessionIds } = body;

    if (!Array.isArray(sessionIds)) {
      return NextResponse.json(
        { error: "sessionIds must be an array" },
        { status: 400 }
      );
    }

    await SessionService.reorderSessions(session.user.id, sessionIds);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reordering sessions:", error);
    return NextResponse.json(
      { error: "Failed to reorder sessions" },
      { status: 500 }
    );
  }
}
