import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as BrowserService from "@/services/browser-service";

/**
 * POST /api/sessions/:id/browser/back - Navigate back in browser history
 */
export const POST = withApiAuth(async (_request, { params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);

    if (!BrowserService.hasSession(params.id)) {
      return errorResponse("No browser session found", 404);
    }

    await BrowserService.goBack(params.id);
    const currentUrl = await BrowserService.getCurrentUrl(params.id);
    return NextResponse.json({ url: currentUrl });
  } catch (error) {
    console.error("Browser back error:", error);
    return errorResponse("Back navigation failed", 500);
  }
});
