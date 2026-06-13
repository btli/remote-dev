/**
 * /api/migration/capabilities — DESTINATION-side capability advertisement.
 *   GET — bundle version, max file-chunk size (stage 2), app version, and
 *         whether this build can decode a gzip-compressed DB-bundle POST.
 *         Used by peer verification and as the pre-flight compatibility check.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import {
  BUNDLE_GZIP_SUPPORTED,
  BUNDLE_VERSION,
  CHUNK_SIZE_BYTES,
} from "@/lib/migration-bundle";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/migration");

/** Read the app version from package.json once (mirrors container.ts). */
function readAppVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch (error) {
    log.warn("Could not read package.json version", { error: String(error) });
    return "0.0.0";
  }
}

const APP_VERSION = readAppVersion();

export const GET = withApiAuth(async () => {
  return NextResponse.json({
    version: BUNDLE_VERSION,
    maxChunkBytes: CHUNK_SIZE_BYTES,
    appVersion: APP_VERSION,
    acceptsGzipBundle: BUNDLE_GZIP_SUPPORTED,
  });
});
