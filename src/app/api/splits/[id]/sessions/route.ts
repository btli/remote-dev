import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as SplitService from "@/services/split-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/splits/:id/sessions - Add a session to the split
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: splitGroupId } = await params;
    const body = await request.json();
    const { sessionId, newSessionName } = body as {
      sessionId?: string;
      newSessionName?: string;
    };

    const split = await SplitService.addToSplit(
      session.user.id,
      splitGroupId,
      sessionId,
      newSessionName
    );

    return NextResponse.json(split, { status: 201 });
  } catch (error) {
    console.error("Error adding to split:", error);
    if (error instanceof SplitService.SplitServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to add to split" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/splits/:id/sessions - Remove a session from the split
 */
export async function DELETE(request: Request, context: RouteParams) {
  // Context param required by Next.js App Router but not used in this handler
  void context;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId query parameter is required" },
        { status: 400 }
      );
    }

    await SplitService.removeFromSplit(session.user.id, sessionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing from split:", error);
    return NextResponse.json(
      { error: "Failed to remove from split" },
      { status: 500 }
    );
  }
}
