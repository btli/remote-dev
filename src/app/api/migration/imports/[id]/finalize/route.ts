/**
 * /api/migration/imports/[id]/finalize — DESTINATION-side completion.
 *   POST — for DB-only migrations, flip importing → completed. For file
 *          migrations: require every chunk, assemble + sha256-verify each
 *          archive, extract (working tree / git clone + essentials /
 *          profiles / agent settings), then complete. Returns the file-phase
 *          conflicts (overwrites, clone/diff issues, …).
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as MigrationImportService from "@/services/migration-import-service";
import { MigrationImportError } from "@/services/migration-import-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/migration");

export const POST = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  try {
    const result = await MigrationImportService.finalizeImport(userId, id);
    return NextResponse.json({ import: result.import, conflicts: result.conflicts });
  } catch (error) {
    if (error instanceof MigrationImportError) {
      log.warn("Import finalize rejected", { importId: id, error: error.message });
      return errorResponse(error.message, error.status, error.code);
    }
    const message = String(error instanceof Error ? error.message : error);
    log.error("Import finalize failed", { importId: id, error: message });
    return errorResponse(message, 500, "FINALIZE_FAILED");
  }
});
