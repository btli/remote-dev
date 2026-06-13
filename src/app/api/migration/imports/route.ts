/**
 * /api/migration/imports — DESTINATION-side import intake.
 *   POST — stage an inbound migration AND apply its DB bundle synchronously
 *          (the DB phase is a single JSON document — fast). Stage 2 moves
 *          file chunks through separate requests between init and finalize.
 *
 * Auth: withApiAuth — the SOURCE instance calls with this instance's API key
 * (Bearer), resolved to the destination user who owns the key.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import {
  bundleManifestSchema,
  migrationOptionsSchema,
} from "@/lib/migration-bundle";
import type { DbBundle } from "@/lib/migration-bundle";
import * as MigrationImportService from "@/services/migration-import-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/migration");

const initSchema = z.object({
  jobId: z.string().min(1),
  sourceInstanceUrl: z.string(),
  manifest: bundleManifestSchema,
  options: migrationOptionsSchema,
  // The bundle is deep-validated by importDb (dbBundleSchema); accept the
  // raw document here to avoid double-parsing the largest payload twice.
  dbBundle: z.unknown(),
});

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<unknown>(request);
  if ("error" in result) return result.error;
  const parsed = initSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { jobId, sourceInstanceUrl, manifest, options, dbBundle } = parsed.data;

  try {
    await MigrationImportService.initImport(
      userId,
      jobId,
      sourceInstanceUrl,
      manifest,
      options,
    );
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const status = message.includes("already exists") ? 409 : 400;
    log.warn("Import init rejected", { jobId, error: message });
    return errorResponse(message, status, "INIT_FAILED");
  }

  try {
    const importResult = await MigrationImportService.importDb(
      userId,
      jobId,
      dbBundle as DbBundle,
    );
    return NextResponse.json(
      { importId: jobId, status: "importing", result: importResult },
      { status: 201 },
    );
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    log.error("DB bundle import failed", { jobId, error: message });
    // The import row is already marked failed; 422 tells the source the
    // payload (not the transport) was the problem.
    return errorResponse(message, 422, "IMPORT_FAILED");
  }
});
