import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as BrowserService from "@/services/browser-service";

/**
 * POST /api/sessions/:id/browser/click - Click at coordinates
 *
 * Body: { x: number, y: number }
 */
export const POST = withApiAuth(async (request, { params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);
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
