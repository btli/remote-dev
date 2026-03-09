import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as BrowserService from "@/services/browser-service";

/**
 * POST /api/sessions/:id/browser/navigate - Navigate browser to URL
 *
 * Creates a browser session if one doesn't exist yet.
 * Body: { url: string }
 */
export const POST = withApiAuth(async (request, { params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);
    const result = await parseJsonBody<{ url: string }>(request);
    if ("error" in result) return result.error;

    if (!BrowserService.hasSession(params.id)) {
      await BrowserService.createBrowserSession(params.id, result.data.url);
    } else {
      await BrowserService.navigate(params.id, result.data.url);
    }

    const currentUrl = await BrowserService.getCurrentUrl(params.id);
    return NextResponse.json({ url: currentUrl });
  } catch (error) {
    console.error("Browser navigate error:", error);
    return errorResponse("Navigation failed", 500);
  }
});
