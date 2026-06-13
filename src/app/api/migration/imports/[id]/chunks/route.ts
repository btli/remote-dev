/**
 * /api/migration/imports/[id]/chunks — DESTINATION-side archive chunk intake.
 *   PUT — one chunk per request, raw bytes in the body, addressed by headers:
 *         X-Archive-Name   one of working-tree|essentials|profiles|agent-settings
 *         X-Chunk-Index    0-based index
 *         X-Chunk-Sha256   sha256 (hex) of this chunk's bytes
 *         X-Total-Chunks   per-archive chunk count (validated vs the manifest)
 *
 * The body is STREAMED to `<staging>/<archive>/chunk-<index>.bin` via a .tmp
 * + rename (atomic). 409 on sha mismatch (tmp deleted); idempotent 200 when
 * the chunk already exists with a matching hash.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as MigrationImportService from "@/services/migration-import-service";
import { MigrationImportError } from "@/services/migration-import-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/migration");

export const PUT = withApiAuth(async (request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");

  const archiveName = request.headers.get("x-archive-name");
  const chunkIndexRaw = request.headers.get("x-chunk-index");
  const sha256 = request.headers.get("x-chunk-sha256");
  const totalChunksRaw = request.headers.get("x-total-chunks");
  if (!archiveName || !chunkIndexRaw || !sha256 || !totalChunksRaw) {
    return errorResponse(
      "X-Archive-Name, X-Chunk-Index, X-Chunk-Sha256 and X-Total-Chunks headers are required",
      400,
      "MISSING_HEADERS",
    );
  }
  const chunkIndex = Number.parseInt(chunkIndexRaw, 10);
  const totalChunks = Number.parseInt(totalChunksRaw, 10);
  if (!Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks)) {
    return errorResponse("Chunk headers must be integers", 400, "BAD_HEADERS");
  }
  if (!request.body) {
    return errorResponse("Request body is required", 400, "EMPTY_BODY");
  }

  try {
    const result = await MigrationImportService.receiveChunk(userId, id, {
      archiveName,
      chunkIndex,
      sha256,
      totalChunks,
      // A web ReadableStream is async-iterable in Node — stream, don't buffer.
      body: request.body as unknown as AsyncIterable<Uint8Array>,
    });
    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      chunksReceived: result.chunksReceived,
    });
  } catch (error) {
    if (error instanceof MigrationImportError) {
      return errorResponse(error.message, error.status, error.code);
    }
    log.error("Chunk intake failed", {
      importId: id,
      archive: archiveName,
      index: chunkIndex,
      error: String(error),
    });
    return errorResponse("Failed to receive chunk", 500);
  }
});
