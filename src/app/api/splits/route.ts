import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as SplitService from "@/services/split-service";
import type { SplitDirection } from "@/types/split";

/**
 * GET /api/splits - Get all split groups for the current user
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const splits = await SplitService.listSplitGroups(session.user.id);

    return NextResponse.json({ splits });
  } catch (error) {
    console.error("Error fetching splits:", error);
    return NextResponse.json(
      { error: "Failed to fetch splits" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/splits - Create a new split from an existing session
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { sourceSessionId, direction, newSessionName } = body as {
      sourceSessionId: string;
      direction: SplitDirection;
      newSessionName?: string;
    };

    if (!sourceSessionId) {
      return NextResponse.json(
        { error: "sourceSessionId is required" },
        { status: 400 }
      );
    }

    if (!direction || !["horizontal", "vertical"].includes(direction)) {
      return NextResponse.json(
        { error: "direction must be 'horizontal' or 'vertical'" },
        { status: 400 }
      );
    }

    const split = await SplitService.createSplit(
      session.user.id,
      sourceSessionId,
      direction,
      newSessionName
    );

    return NextResponse.json(split, { status: 201 });
  } catch (error) {
    console.error("Error creating split:", error);
    if (error instanceof SplitService.SplitServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create split" },
      { status: 500 }
    );
  }
}
