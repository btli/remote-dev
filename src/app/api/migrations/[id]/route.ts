/**
 * /api/migrations/[id] — poll one SOURCE-side migration job.
 *   GET — full job row (status, conflictReportJson, destProjectId, …).
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as MigrationService from "@/services/migration-service";

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  const job = await MigrationService.getJob(userId, id);
  if (!job) return errorResponse("Migration job not found", 404, "NOT_FOUND");
  return NextResponse.json({ job });
});
