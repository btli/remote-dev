import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as BrowserService from "@/services/browser-service";

/**
 * GET /api/sessions/:id/browser/snapshot - Get accessibility tree snapshot
 *
 * Returns JSON representation of the page's accessibility tree.
 */
export const GET = withApiAuth(async (_request, { params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);

    if (!BrowserService.hasSession(params.id)) {
      return errorResponse("No browser session found", 404);
    }

    const tree = await BrowserService.snapshot(params.id);
    return new NextResponse(tree, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Browser snapshot error:", error);
    return errorResponse("Snapshot failed", 500);
  }
});
