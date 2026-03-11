import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as BrowserService from "@/services/browser-service";
import * as SessionService from "@/services/session-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sessions");

/**
 * POST /api/sessions/:id/browser/evaluate - Evaluate JavaScript in browser context
 *
 * Body: { expression: string }
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);

    const session = await SessionService.getSession(params.id, userId);
    if (!session) return errorResponse("Session not found", 404);

    const result = await parseJsonBody<{ expression: string }>(request);
    if ("error" in result) return result.error;

    const { expression } = result.data;
    if (typeof expression !== "string") {
      return errorResponse("expression must be a string", 400);
    }

    if (!BrowserService.hasSession(params.id)) {
      return errorResponse("No browser session found", 404);
    }

    const evalResult = await BrowserService.evaluate(params.id, expression);
    return NextResponse.json({ result: evalResult });
  } catch (error) {
    log.error("Browser evaluate error", { error: String(error) });
    return errorResponse("Evaluation failed", 500);
  }
});
