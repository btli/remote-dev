import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getSessionMetadata } from "@/services/session-metadata-service";

/**
 * GET /api/sessions/:id/metadata — [n6uc]
 *
 * Aggregated per-session observability: branch + dirty count + ahead/behind,
 * the linked PR (cache-first), the session's own listening ports, and a derived
 * needs-attention level. Supersedes `/git-status` (kept as a thin alias).
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const sessionId = params?.id;
  if (!sessionId) {
    return errorResponse("Session ID is required", 400, "ID_REQUIRED");
  }
  const metadata = await getSessionMetadata(sessionId, userId);
  if (!metadata) {
    return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");
  }
  return NextResponse.json(metadata);
});
