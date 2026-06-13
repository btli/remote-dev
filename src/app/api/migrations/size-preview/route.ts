/**
 * /api/migrations/size-preview — SOURCE-side transfer size estimate.
 *   POST { projectId, workingTreeMode } →
 *        { workingTreeBytes, profilesBytes, agentSettingsBytes, totalBytes, warning? }
 *
 * `du`-based and bounded to ~2s: numbers are uncompressed-disk ESTIMATES of
 * what the archives would carry, not exact wire sizes. On any failure it
 * degrades to zeros + a warning rather than erroring.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as MigrationFileService from "@/services/migration-file-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/migrations");

const previewSchema = z.object({
  projectId: z.string().min(1),
  workingTreeMode: z.enum(["full_tar", "git_essentials", "none"]),
  includeDotEnv: z.boolean().optional(),
});

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<unknown>(request);
  if ("error" in result) return result.error;
  const parsed = previewSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const preview = await MigrationFileService.sizePreview(
      userId,
      parsed.data.projectId,
      parsed.data.workingTreeMode,
      parsed.data.includeDotEnv ?? true,
    );
    return NextResponse.json(preview);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (message.includes("not found")) {
      return errorResponse("Project not found", 404, "NOT_FOUND");
    }
    log.error("Size preview failed", { error: message });
    return errorResponse("Failed to estimate migration size", 500);
  }
});
