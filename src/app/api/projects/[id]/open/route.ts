import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { withApiAuth, errorResponse } from "@/lib/api";
import { execFileNoThrow } from "@/lib/exec";
import { container } from "@/infrastructure/container";
import { NodeRef } from "@/domain/value-objects/NodeRef";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/projects/open");

const FILE_MANAGER: Record<string, string> = {
  darwin: "open",
  win32: "explorer.exe",
  linux: "xdg-open",
};

/**
 * POST /api/projects/:id/open — Open the project's default working directory
 * in the OS file manager (Finder on macOS, explorer.exe on Windows, xdg-open on Linux).
 *
 * Replaces the legacy `/api/folders/:id/open` route, which was removed during the
 * folder → project tree migration.
 */
export const POST = withApiAuth(async (_request, { userId, params }) => {
  const projectId = params!.id;

  const prefs = await container.nodePreferencesRepository.findForNode(
    NodeRef.project(projectId),
    userId,
  );
  const directory = prefs?.fields.defaultWorkingDirectory;

  if (!directory) {
    return errorResponse("No working directory configured for this project", 400);
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
    log.error("Failed to open project directory", { projectId, error: result.stderr });
    return errorResponse("Failed to open project directory", 500);
  }

  log.debug("Opened project directory in file manager", { projectId });
  return NextResponse.json({ ok: true });
});
