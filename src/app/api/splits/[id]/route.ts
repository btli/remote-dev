import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SplitService from "@/services/split-service";
import type { SplitDirection } from "@/types/split";

/**
 * GET /api/splits/:id - Get a specific split group
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return errorResponse("Split ID is required", 400, "MISSING_ID");
    }

    const split = await SplitService.getSplitGroup(id, userId);

    if (!split) {
      return errorResponse("Split group not found", 404, "NOT_FOUND");
    }

    return NextResponse.json(split);
  } catch (error) {
    console.error("Error fetching split:", error);
    return errorResponse("Failed to fetch split", 500);
  }
});

/**
 * PATCH /api/splits/:id - Update split direction
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return errorResponse("Split ID is required", 400, "MISSING_ID");
    }

    const result = await parseJsonBody<{ direction?: SplitDirection }>(request);
    if ("error" in result) return result.error;
    const { direction } = result.data;

    if (direction && !["horizontal", "vertical"].includes(direction)) {
      return errorResponse("direction must be 'horizontal' or 'vertical'", 400, "INVALID_DIRECTION");
    }

    if (direction) {
      const updated = await SplitService.changeSplitDirection(userId, id, direction);
      return NextResponse.json(updated);
    }

    return errorResponse("No updates provided", 400, "NO_UPDATES");
  } catch (error) {
    console.error("Error updating split:", error);
    if (error instanceof SplitService.SplitServiceError) {
      return errorResponse(error.message, 404, error.code);
    }
    return errorResponse("Failed to update split", 500);
  }
});

/**
 * DELETE /api/splits/:id - Dissolve a split group
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return errorResponse("Split ID is required", 400, "MISSING_ID");
    }

    await SplitService.dissolveSplit(userId, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error dissolving split:", error);
    return errorResponse("Failed to dissolve split", 500);
  }
});
