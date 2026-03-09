import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as BrowserService from "@/services/browser-service";
import * as SessionService from "@/services/session-service";

/**
 * POST /api/sessions/:id/browser/type - Type text or fill a form field
 *
 * Body: { text: string } for keyboard typing
 * Body: { selector: string, text: string } for filling a specific element
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);

    const session = await SessionService.getSession(params.id, userId);
    if (!session) return errorResponse("Session not found", 404);

    if (!BrowserService.hasSession(params.id)) {
      return errorResponse("No browser session found", 404);
    }

    const result = await parseJsonBody<{ text: string; selector?: string }>(request);
    if ("error" in result) return result.error;

    const { text, selector } = result.data;
    if (typeof text !== "string") {
      return errorResponse("text must be a string", 400);
    }

    if (selector) {
      await BrowserService.fill(params.id, selector, text);
    } else {
      await BrowserService.typeText(params.id, text);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Browser type error:", error);
    return errorResponse("Type failed", 500);
  }
});
