import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import { generateWsToken } from "@/server/terminal";
import * as SessionService from "@/services/session-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await params;

  // Verify the session belongs to this user
  const terminalSession = await SessionService.getSession(sessionId, session.user.id);
  if (!terminalSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const token = generateWsToken(sessionId, session.user.id);

  return NextResponse.json({ token });
}
