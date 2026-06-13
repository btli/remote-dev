/**
 * /api/migration/imports/[id]/finalize — DESTINATION-side completion.
 *   POST — confirm the DB import landed and mark the import completed.
 *          (Stage 2 will require the file phases to have finished first.)
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as MigrationImportService from "@/services/migration-import-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/migration");

export const POST = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  try {
    const row = await MigrationImportService.finalizeImport(userId, id);
    return NextResponse.json({ import: row });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (message.includes("not found")) {
      return errorResponse("Import not found", 404, "NOT_FOUND");
    }
    log.warn("Import finalize rejected", { importId: id, error: message });
    return errorResponse(message, 409, "FINALIZE_REJECTED");
  }
});
