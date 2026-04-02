import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getIssueComments, getIssueEvents } from "@/services/beads-service";
import { validateProjectPath } from "@/lib/beads-auth";

export const GET = withApiAuth(async (request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Issue ID is required", 400);

  const url = new URL(request.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return errorResponse("projectPath is required", 400);

  const resolved = await validateProjectPath(userId, projectPath);
  if (!resolved) return errorResponse("Invalid or unauthorized project path", 403);

  const includeEvents = url.searchParams.get("includeEvents") === "true";

  if (includeEvents) {
    const [comments, events] = await Promise.all([
      getIssueComments(resolved, id),
      getIssueEvents(resolved, id),
    ]);
    return NextResponse.json({ comments, events });
  }

  const comments = await getIssueComments(resolved, id);
  return NextResponse.json(comments);
});
