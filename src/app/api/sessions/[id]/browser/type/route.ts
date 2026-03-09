import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as BrowserService from "@/services/browser-service";

/**
 * POST /api/sessions/:id/browser/type - Type text or fill a form field
 *
 * Body: { text: string } for keyboard typing
 * Body: { selector: string, text: string } for filling a specific element
 */
export const POST = withApiAuth(async (request, { params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);
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
