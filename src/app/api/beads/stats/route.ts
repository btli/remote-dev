import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getStats } from "@/services/beads-service";
import { validateProjectPath } from "@/lib/beads-auth";

export const GET = withApiAuth(async (request, { userId }) => {
  const url = new URL(request.url);
  const projectPath = url.searchParams.get("projectPath");

  if (!projectPath) {
    return errorResponse("projectPath is required", 400);
  }

  const resolved = await validateProjectPath(userId, projectPath);
  if (!resolved) {
    return errorResponse("Invalid or unauthorized project path", 403);
  }

  const stats = await getStats(resolved);
  return NextResponse.json(stats);
});
