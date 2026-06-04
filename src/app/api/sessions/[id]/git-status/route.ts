import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getSessionMetadata } from "@/services/session-metadata-service";

/**
 * GET /api/sessions/:id/git-status — [n6uc]
 *
 * @deprecated Use `/api/sessions/:id/metadata`. Retained as a thin alias for
 * back-compat (mobile/Flutter callers): returns only the git + PR subset of the
 * aggregated metadata, in the original response shape.
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const sessionId = params?.id;
  if (!sessionId) {
    return errorResponse("Session ID is required", 400, "ID_REQUIRED");
  }
  const meta = await getSessionMetadata(sessionId, userId);
  if (!meta) {
    return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");
  }
  return NextResponse.json({
    branch: meta.git?.branch ?? null,
    ahead: meta.git?.ahead ?? 0,
    behind: meta.git?.behind ?? 0,
    pr: meta.pr
      ? { number: meta.pr.number, state: meta.pr.state, url: meta.pr.url }
      : null,
  });
});
