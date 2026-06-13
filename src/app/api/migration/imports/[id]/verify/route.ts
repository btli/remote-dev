/**
 * /api/migration/imports/[id]/verify — DESTINATION-side verification.
 *   GET — recount imported rows vs the counts recorded at import time.
 *         Filesystem checks (working tree, profile dirs) arrive with stage 2.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as MigrationImportService from "@/services/migration-import-service";
import { MigrationImportError } from "@/services/migration-import-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/migration");

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  try {
    const verify = await MigrationImportService.verifyImport(userId, id);
    return NextResponse.json(verify);
  } catch (error) {
    if (error instanceof MigrationImportError) {
      return errorResponse(error.message, error.status, error.code);
    }
    log.error("Import verify failed", { importId: id, error: String(error) });
    return errorResponse("Failed to verify import", 500);
  }
});
