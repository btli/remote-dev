import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SplitService from "@/services/split-service";

/**
 * POST /api/splits/:id/sessions - Add a session to the split
 */
export const POST = withAuth(async (request, { userId, params }) => {
  try {
    const splitGroupId = params?.id;
    if (!splitGroupId) {
      return errorResponse("Split ID is required", 400, "MISSING_ID");
    }

    const result = await parseJsonBody<{
      sessionId?: string;
      newSessionName?: string;
    }>(request);
    if ("error" in result) return result.error;
    const { sessionId, newSessionName } = result.data;

    const split = await SplitService.addToSplit(
      userId,
      splitGroupId,
      sessionId,
      newSessionName
    );

    return NextResponse.json(split, { status: 201 });
  } catch (error) {
    console.error("Error adding to split:", error);
    if (error instanceof SplitService.SplitServiceError) {
      return errorResponse(error.message, 400, error.code);
    }
    return errorResponse("Failed to add to split", 500);
  }
});

/**
 * DELETE /api/splits/:id/sessions - Remove a session from the split
 */
export const DELETE = withAuth(async (request, { userId }) => {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      return errorResponse("sessionId query parameter is required", 400, "MISSING_SESSION_ID");
    }

    await SplitService.removeFromSplit(userId, sessionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing from split:", error);
    return errorResponse("Failed to remove from split", 500);
  }
});
