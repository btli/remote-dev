import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateWsToken } from "@/server/terminal";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await params;
  const token = generateWsToken(sessionId, session.user.id);

  return NextResponse.json({ token });
}
