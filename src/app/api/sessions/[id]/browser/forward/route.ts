import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as BrowserService from "@/services/browser-service";
import * as SessionService from "@/services/session-service";

/**
 * POST /api/sessions/:id/browser/forward - Navigate forward in browser history
 */
export const POST = withApiAuth(async (_request, { userId, params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);

    const session = await SessionService.getSession(params.id, userId);
    if (!session) return errorResponse("Session not found", 404);

    if (!BrowserService.hasSession(params.id)) {
      return errorResponse("No browser session found", 404);
    }

    await BrowserService.goForward(params.id);
    const currentUrl = await BrowserService.getCurrentUrl(params.id);
    return NextResponse.json({ url: currentUrl });
  } catch (error) {
    console.error("Browser forward error:", error);
    return errorResponse("Forward navigation failed", 500);
  }
});
