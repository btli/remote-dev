/**
 * /api/crown/[id] (epic remote-dev-oyej.6)
 *   GET  — run status + candidates (+ diffs + judge result).
 *   POST — {action:"pr", candidateId} manual override: open a PR for an
 *          operator-chosen candidate, ignoring the judge's winner.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as CrownService from "@/services/crown-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/crown");

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  const result = await CrownService.getCrown(id, userId);
  if (!result) return errorResponse("Crown run not found", 404, "NOT_FOUND");
  return NextResponse.json(result);
});

interface CrownActionBody {
  action?: string;
  candidateId?: string;
}

export const POST = withApiAuth(async (request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  try {
    const result = await parseJsonBody<CrownActionBody>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    if (body.action !== "pr") {
      return errorResponse(
        'Unsupported action (expected "pr")',
        400,
        "INVALID_ACTION",
      );
    }
    if (!body.candidateId) {
      return errorResponse("candidateId is required", 400, "MISSING_CANDIDATE");
    }

    const prUrl = await CrownService.prForCandidate(
      id,
      body.candidateId,
      userId,
    );
    if (!prUrl) {
      return errorResponse(
        "Crown run or candidate not found (or candidate has no branch)",
        404,
        "NOT_FOUND",
      );
    }
    return NextResponse.json({ prUrl });
  } catch (error) {
    log.error("Error opening crown override PR", { error: String(error) });
    return errorResponse("Failed to open PR", 500);
  }
});
