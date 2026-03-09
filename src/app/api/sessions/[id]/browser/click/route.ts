import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as BrowserService from "@/services/browser-service";
import * as SessionService from "@/services/session-service";

/**
 * POST /api/sessions/:id/browser/click - Click at coordinates
 *
 * Body: { x: number, y: number }
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);

    const session = await SessionService.getSession(params.id, userId);
    if (!session) return errorResponse("Session not found", 404);

    if (!BrowserService.hasSession(params.id)) {
      return errorResponse("No browser session found", 404);
    }

    const result = await parseJsonBody<{ x: number; y: number }>(request);
    if ("error" in result) return result.error;

    const { x, y } = result.data;
    if (typeof x !== "number" || typeof y !== "number") {
      return errorResponse("x and y must be numbers", 400);
    }

    await BrowserService.click(params.id, x, y);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Browser click error:", error);
    return errorResponse("Click failed", 500);
  }
});
