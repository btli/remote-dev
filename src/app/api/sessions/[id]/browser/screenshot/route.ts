import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as BrowserService from "@/services/browser-service";
import * as SessionService from "@/services/session-service";

/**
 * GET /api/sessions/:id/browser/screenshot - Get current page screenshot
 *
 * Returns image/jpeg binary response.
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);

    const session = await SessionService.getSession(params.id, userId);
    if (!session) return errorResponse("Session not found", 404);

    if (!BrowserService.hasSession(params.id)) {
      return errorResponse("No browser session found", 404);
    }

    const buffer = await BrowserService.screenshot(params.id);
    // Convert Node.js Buffer to a fresh ArrayBuffer for the Response constructor
    const arrayBuffer = buffer.buffer instanceof ArrayBuffer
      ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      : new Uint8Array(buffer).buffer;
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      },
    }) as NextResponse;
  } catch (error) {
    console.error("Browser screenshot error:", error);
    return errorResponse("Screenshot failed", 500);
  }
});
