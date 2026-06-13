import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getIssueComments, getIssueEvents } from "@/services/beads-service";
import { validateProjectPath } from "@/lib/beads-auth";
import { isBeadsUnavailable, isValidIssueId } from "@/lib/beads-cli";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/beads/[id]/comments");

export const GET = withApiAuth(async (request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Issue ID is required", 400);
  if (!isValidIssueId(id)) return errorResponse("Invalid issue ID", 400);

  const url = new URL(request.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return errorResponse("projectPath is required", 400);

  const resolved = await validateProjectPath(userId, projectPath);
  if (!resolved) return errorResponse("Invalid or unauthorized project path", 403);

  const includeEvents = url.searchParams.get("includeEvents") === "true";

  // An authorized path without a .beads/ directory has no comments/events.
  if (!existsSync(join(resolved, ".beads"))) {
    return NextResponse.json(includeEvents ? { comments: [], events: [] } : []);
  }

  try {
    if (includeEvents) {
      const [comments, events] = await Promise.all([
        getIssueComments(resolved, id),
        getIssueEvents(resolved, id),
      ]);
      return NextResponse.json({ comments, events });
    }

    const comments = await getIssueComments(resolved, id);
    return NextResponse.json(comments);
  } catch (err) {
    // bd unable to produce data is expected — return empty rather than 500
    if (isBeadsUnavailable(err)) {
      log.debug("bd unavailable, returning empty comments", { error: String(err) });
      return NextResponse.json(
        includeEvents ? { comments: [], events: [], unavailable: true } : []
      );
    }
    log.error("getIssueComments failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
});
