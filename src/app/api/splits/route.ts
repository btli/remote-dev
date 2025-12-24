import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SplitService from "@/services/split-service";
import type { SplitDirection } from "@/types/split";

/**
 * GET /api/splits - Get all split groups for the current user
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const splits = await SplitService.listSplitGroups(userId);
    return NextResponse.json({ splits });
  } catch (error) {
    console.error("Error fetching splits:", error);
    return errorResponse("Failed to fetch splits", 500);
  }
});

/**
 * POST /api/splits - Create a new split from an existing session
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      sourceSessionId: string;
      direction: SplitDirection;
      newSessionName?: string;
    }>(request);
    if ("error" in result) return result.error;
    const { sourceSessionId, direction, newSessionName } = result.data;

    if (!sourceSessionId) {
      return errorResponse("sourceSessionId is required", 400, "MISSING_SOURCE_SESSION");
    }

    if (!direction || !["horizontal", "vertical"].includes(direction)) {
      return errorResponse("direction must be 'horizontal' or 'vertical'", 400, "INVALID_DIRECTION");
    }

    const split = await SplitService.createSplit(
      userId,
      sourceSessionId,
      direction,
      newSessionName
    );

    return NextResponse.json(split, { status: 201 });
  } catch (error) {
    console.error("Error creating split:", error);
    if (error instanceof SplitService.SplitServiceError) {
      return errorResponse(error.message, 400, error.code);
    }
    return errorResponse("Failed to create split", 500);
  }
});
