import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as SplitService from "@/services/split-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/splits/:id/layout - Update pane sizes in a split
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: splitGroupId } = await params;
    const body = await request.json();
    const { layout } = body as {
      layout: Array<{ sessionId: string; size: number }>;
    };

    if (!layout || !Array.isArray(layout)) {
      return NextResponse.json(
        { error: "layout array is required" },
        { status: 400 }
      );
    }

    // Validate sizes sum to approximately 1
    const totalSize = layout.reduce((sum, item) => sum + item.size, 0);
    if (Math.abs(totalSize - 1) > 0.01) {
      return NextResponse.json(
        { error: "layout sizes must sum to 1" },
        { status: 400 }
      );
    }

    await SplitService.updateSplitLayout(session.user.id, splitGroupId, layout);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating split layout:", error);
    if (error instanceof SplitService.SplitServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Failed to update split layout" },
      { status: 500 }
    );
  }
}
