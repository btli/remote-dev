import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getIssues } from "@/services/beads-service";
import { validateProjectPath } from "@/lib/beads-auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/beads");

const VALID_STATUSES = new Set(["open", "in_progress", "closed", "deferred"]);
const VALID_TYPES = new Set(["task", "bug", "feature", "epic", "chore", "message"]);

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

  const statusParam = url.searchParams.get("status");
  const status = statusParam && VALID_STATUSES.has(statusParam) ? statusParam : undefined;
  const issueTypeParam = url.searchParams.get("issueType");
  const issueType = issueTypeParam && VALID_TYPES.has(issueTypeParam) ? issueTypeParam : undefined;
  const retentionParam = url.searchParams.get("retentionDays");
  const closedRetentionDays = retentionParam
    ? Math.max(1, Math.min(365, parseInt(retentionParam, 10) || 7))
    : undefined;

  try {
    const issues = await getIssues(resolved, {
      status: status as "open" | "in_progress" | "closed" | "deferred" | undefined,
      issueType: issueType as "task" | "bug" | "feature" | "epic" | "chore" | "message" | undefined,
      closedRetentionDays,
    });

    return NextResponse.json(issues);
  } catch (err) {
    log.error("getIssues failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
});
