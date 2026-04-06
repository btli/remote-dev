import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { withAuth, errorResponse } from "@/lib/api";
import { execFileNoThrow } from "@/lib/exec";
import { getFolderPreferences } from "@/services/preferences-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/folders/open");

const FILE_MANAGER: Record<string, string> = {
  darwin: "open",
  win32: "explorer.exe",
  linux: "xdg-open",
};

/**
 * POST /api/folders/:id/open - Open folder in OS file manager
 */
export const POST = withAuth(async (_request, { userId, params }) => {
  const folderId = params!.id;

  const prefs = await getFolderPreferences(folderId, userId);
  const directory = prefs?.defaultWorkingDirectory;

  if (!directory) {
    return errorResponse("No working directory configured for this folder", 400);
  }

  // Verify path exists and is a directory
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) {
      return errorResponse("Path is not a directory", 400);
    }
  } catch {
    return errorResponse("Directory does not exist", 400);
  }

  const command = FILE_MANAGER[process.platform] ?? "xdg-open";
  const result = await execFileNoThrow(command, [directory]);

  if (result.exitCode !== 0) {
    log.error("Failed to open folder", { folderId, error: result.stderr });
    return errorResponse("Failed to open folder", 500);
  }

  log.debug("Opened folder in file manager", { folderId });
  return NextResponse.json({ ok: true });
});
