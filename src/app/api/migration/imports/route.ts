/**
 * /api/migration/imports — DESTINATION-side import intake.
 *   POST — stage an inbound migration AND apply its DB bundle synchronously
 *          (the DB phase is a single JSON document — fast). Stage 2 moves
 *          file chunks through separate requests between init and finalize.
 *
 * The body may arrive gzip-compressed (`Content-Encoding: gzip`): the whole
 * bundle travels as one POST and the wire path caps the on-wire request size at
 * ~100 MB, so a gzip-aware source compresses it (advertised via
 * `acceptsGzipBundle` in the capabilities document). {@link readMaybeGzippedJson}
 * decodes both gzip and plain bodies — Next.js does NOT auto-gunzip requests.
 *
 * Auth: withApiAuth — the SOURCE instance calls with this instance's API key
 * (Bearer), resolved to the destination user who owns the key.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse } from "@/lib/api";
import {
  bundleManifestSchema,
  migrationOptionsSchema,
} from "@/lib/migration-bundle";
import type { DbBundle } from "@/lib/migration-bundle";
import { readMaybeGzippedJson } from "@/lib/migration-gzip";
import * as MigrationImportService from "@/services/migration-import-service";
import { MigrationImportError } from "@/services/migration-import-service";
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
  let rawBody: unknown;
  try {
    rawBody = await readMaybeGzippedJson<unknown>(request);
  } catch (error) {
    log.warn("Import body could not be read", { error: String(error) });
    return errorResponse(
      "Invalid request body (malformed JSON or gzip)",
      400,
      "INVALID_BODY",
    );
  }
  const parsed = initSchema.safeParse(rawBody);
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
    log.warn("Import init rejected", { jobId, error: message });
    if (error instanceof MigrationImportError) {
      return errorResponse(error.message, error.status, error.code);
    }
    return errorResponse(message, 400, "INIT_FAILED");
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
