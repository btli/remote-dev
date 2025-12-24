import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SplitService from "@/services/split-service";

/**
 * PUT /api/splits/:id/layout - Update pane sizes in a split
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  try {
    const splitGroupId = params?.id;
    if (!splitGroupId) {
      return errorResponse("Split ID is required", 400, "MISSING_ID");
    }

    const result = await parseJsonBody<{
      layout: Array<{ sessionId: string; size: number }>;
    }>(request);
    if ("error" in result) return result.error;
    const { layout } = result.data;

    if (!layout || !Array.isArray(layout)) {
      return errorResponse("layout array is required", 400, "MISSING_LAYOUT");
    }

    // Validate sizes sum to approximately 1
    const totalSize = layout.reduce((sum, item) => sum + item.size, 0);
    if (Math.abs(totalSize - 1) > 0.01) {
      return errorResponse("layout sizes must sum to 1", 400, "INVALID_LAYOUT_SIZES");
    }

    await SplitService.updateSplitLayout(userId, splitGroupId, layout);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating split layout:", error);
    if (error instanceof SplitService.SplitServiceError) {
      return errorResponse(error.message, 404, error.code);
    }
    return errorResponse("Failed to update split layout", 500);
  }
});
