import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as SplitService from "@/services/split-service";
import type { SplitDirection } from "@/types/split";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/splits/:id - Get a specific split group
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const split = await SplitService.getSplitGroup(id, session.user.id);

    if (!split) {
      return NextResponse.json(
        { error: "Split group not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(split);
  } catch (error) {
    console.error("Error fetching split:", error);
    return NextResponse.json(
      { error: "Failed to fetch split" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/splits/:id - Update split direction
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { direction } = body as { direction?: SplitDirection };

    if (direction && !["horizontal", "vertical"].includes(direction)) {
      return NextResponse.json(
        { error: "direction must be 'horizontal' or 'vertical'" },
        { status: 400 }
      );
    }

    if (direction) {
      const updated = await SplitService.changeSplitDirection(
        session.user.id,
        id,
        direction
      );
      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  } catch (error) {
    console.error("Error updating split:", error);
    if (error instanceof SplitService.SplitServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Failed to update split" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/splits/:id - Dissolve a split group
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await SplitService.dissolveSplit(session.user.id, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error dissolving split:", error);
    return NextResponse.json(
      { error: "Failed to dissolve split" },
      { status: 500 }
    );
  }
}
