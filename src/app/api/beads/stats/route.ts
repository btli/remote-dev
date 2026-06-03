import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getStats } from "@/services/beads-service";
import { validateProjectPath } from "@/lib/beads-auth";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";
import type { BeadsStats } from "@/types/beads";

const log = createLogger("api/beads/stats");

const EMPTY_STATS: BeadsStats = {
  total: 0,
  open: 0,
  inProgress: 0,
  closed: 0,
  blocked: 0,
  ready: 0,
  deferred: 0,
};

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

  // An authorized path without a .beads/ directory has no dolt server —
  // return zeroed stats rather than attempting a query that would fail.
  if (!existsSync(join(resolved, ".beads"))) {
    return NextResponse.json(EMPTY_STATS);
  }

  try {
    const stats = await getStats(resolved);
    return NextResponse.json(stats);
  } catch (err) {
    const msg = String(err);
    // Dolt server not running is expected — return empty rather than 500
    if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) {
      log.debug("Dolt server not reachable, returning empty stats", { error: msg });
      return NextResponse.json(EMPTY_STATS);
    }
    log.error("getStats failed", { error: msg });
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
});
