/**
 * /api/migration/imports/[id] — DESTINATION-side import record.
 *   GET    — status poll, incl. `receivedChunks` per archive (derived from
 *            the staging dir) so an interrupted source can resume uploads.
 *   DELETE — roll back: remove the imported project/profiles + staging dir.
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
  const row = await MigrationImportService.getImport(userId, id);
  if (!row) return errorResponse("Import not found", 404, "NOT_FOUND");
  const receivedChunks = await MigrationImportService.listReceivedChunks(row);
  return NextResponse.json({ import: row, receivedChunks });
});

export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  try {
    await MigrationImportService.rollbackImport(userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MigrationImportError) {
      return errorResponse(error.message, error.status, error.code);
    }
    log.error("Import rollback failed", { importId: id, error: String(error) });
    return errorResponse("Failed to roll back import", 500);
  }
});
