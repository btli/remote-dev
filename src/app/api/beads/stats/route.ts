import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getStats } from "@/services/beads-service";
import { validateProjectPath } from "@/lib/beads-auth";
import { isBeadsUnavailable } from "@/lib/beads-cli";
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
    // bd unable to produce data (missing / timeout / non-zero exit) is expected — flag it rather than 500
    if (isBeadsUnavailable(err)) {
      log.debug("bd unavailable, returning empty stats", { error: String(err) });
      return NextResponse.json({ ...EMPTY_STATS, unavailable: true });
    }
    log.error("getStats failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
});
