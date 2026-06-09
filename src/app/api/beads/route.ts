import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getIssues } from "@/services/beads-service";
import { validateProjectPath } from "@/lib/beads-auth";
import { isDoltUnavailable } from "@/lib/beads-db";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";
import type { BeadsStatus, BeadsIssueType } from "@/types/beads";

const log = createLogger("api/beads");

const VALID_STATUSES = new Set(["open", "in_progress", "blocked", "closed", "deferred"]);
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

  // Check if beads is initialized in this project
  const beadsDir = join(resolved, ".beads");
  const initialized = existsSync(beadsDir);

  if (!initialized) {
    return NextResponse.json({ initialized: false, issues: [] });
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
      status: status as BeadsStatus | undefined,
      issueType: issueType as BeadsIssueType | undefined,
      closedRetentionDays,
    });

    return NextResponse.json({ initialized: true, issues });
  } catch (err) {
    // Dolt server not running is expected — flag it rather than 500
    if (isDoltUnavailable(err)) {
      log.debug("Dolt server not reachable, returning unavailable", { error: String(err) });
      return NextResponse.json({ initialized: true, unavailable: true, issues: [] });
    }
    log.error("getIssues failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
});
