import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getIssue } from "@/services/beads-service";
import { validateProjectPath } from "@/lib/beads-auth";
import { isBeadsUnavailable, isValidIssueId } from "@/lib/beads-cli";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/beads/[id]");

export const GET = withApiAuth(async (request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Issue ID is required", 400);
  if (!isValidIssueId(id)) return errorResponse("Invalid issue ID", 400);

  const url = new URL(request.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return errorResponse("projectPath is required", 400);

  const resolved = await validateProjectPath(userId, projectPath);
  if (!resolved) return errorResponse("Invalid or unauthorized project path", 403);

  // An authorized path without a .beads/ directory has no issues to return.
  if (!existsSync(join(resolved, ".beads"))) {
    return errorResponse("Issue not found", 404);
  }

  try {
    const issue = await getIssue(resolved, id);
    if (!issue) return errorResponse("Issue not found", 404);
    return NextResponse.json(issue);
  } catch (err) {
    // bd unable to produce data is expected — the issue is simply unavailable
    if (isBeadsUnavailable(err)) {
      log.debug("bd unavailable, treating issue as not found", { error: String(err) });
      return NextResponse.json(
        { error: "Issue not found", unavailable: true },
        { status: 404 }
      );
    }
    log.error("getIssue failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
});
