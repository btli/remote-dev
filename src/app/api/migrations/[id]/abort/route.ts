/**
 * /api/migrations/[id]/abort — abort a non-terminal SOURCE-side migration job.
 *   POST — mark aborted (the runner observes it via conditional transitions)
 *          + best-effort destination rollback.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as MigrationService from "@/services/migration-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/migrations");

export const POST = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  try {
    const job = await MigrationService.abortJob(userId, id);
    if (!job) return errorResponse("Migration job not found", 404, "NOT_FOUND");
    return NextResponse.json({ job });
  } catch (error) {
    log.error("Error aborting migration job", { jobId: id, error: String(error) });
    return errorResponse("Failed to abort migration job", 500);
  }
});
