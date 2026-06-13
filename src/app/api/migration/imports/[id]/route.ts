/**
 * /api/migration/imports/[id] — DESTINATION-side import record.
 *   GET    — status poll.
 *   DELETE — roll back: remove the imported project/profiles + staging dir.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as MigrationImportService from "@/services/migration-import-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/migration");

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  const row = await MigrationImportService.getImport(userId, id);
  if (!row) return errorResponse("Import not found", 404, "NOT_FOUND");
  return NextResponse.json({ import: row });
});

export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  try {
    await MigrationImportService.rollbackImport(userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (message.includes("not found")) {
      return errorResponse("Import not found", 404, "NOT_FOUND");
    }
    log.error("Import rollback failed", { importId: id, error: message });
    return errorResponse("Failed to roll back import", 500);
  }
});
