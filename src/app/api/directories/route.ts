import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { resolve } from "node:path";
import { getFsPromises, getFs } from "@/lib/dynamic-fs";
import { createLogger } from "@/lib/logger";
import { validateBrowsePath, validateFolderName } from "@/lib/directory-browse";

const log = createLogger("api/directories");

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * GET /api/directories - List contents of a directory
 *
 * Query params:
 *   - path: The filesystem path to browse (defaults to HOME)
 *   - showHidden: Whether to show hidden files (default: false)
 *   - dirsOnly: Whether to show only directories (default: true)
 *
 * Returns:
 *   - path: Current path (realpath resolved)
 *   - parent: Parent path (null if at root of allowed area)
 *   - entries: Array of directory entries
 */
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get("path") || process.env.HOME || "/tmp";
  const showHidden = searchParams.get("showHidden") === "true";
  const dirsOnly = searchParams.get("dirsOnly") !== "false";

  const validatedPath = await validateBrowsePath(rawPath);
  if (!validatedPath) {
    return errorResponse("Invalid path - must be within allowed directories", 400);
  }

  const fsp = await getFsPromises();
  const fs = await getFs();

  // Check if path exists and is accessible
  try {
    await fsp.access(validatedPath, fs.constants.R_OK);
  } catch {
    return errorResponse("Path does not exist or is not accessible", 404);
  }

  try {
    const pathStat = await fsp.stat(validatedPath);
    if (!pathStat.isDirectory()) {
      return errorResponse("Path is not a directory", 400);
    }

    const rawEntries = await fsp.readdir(validatedPath);
    const entries: DirectoryEntry[] = [];

    for (const name of rawEntries) {
      // Skip hidden files unless requested
      if (!showHidden && name.startsWith(".")) {
        continue;
      }

      // Skip common non-browsable directories
      if (["node_modules", "__pycache__", ".git"].includes(name)) {
        continue;
      }

      const fullPath = resolve(validatedPath, name);
      try {
        const entryStat = await fsp.stat(fullPath);
        const isDirectory = entryStat.isDirectory();

        // Skip files if dirsOnly
        if (dirsOnly && !isDirectory) {
          continue;
        }

        entries.push({
          name,
          path: fullPath,
          isDirectory,
        });
      } catch {
        // Skip entries we can't stat (permission issues)
        continue;
      }
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    // Calculate parent path
    const parent = resolve(validatedPath, "..");
    const validParent = await validateBrowsePath(parent);

    return NextResponse.json({
      path: validatedPath,
      parent: validParent !== validatedPath ? validParent : null,
      entries,
    });
  } catch (error) {
    log.error("Error reading directory", { error: String(error) });
    return errorResponse("Failed to read directory", 500);
  }
});

/**
 * POST /api/directories - Create a new folder
 *
 * Body:
 *   - path: The parent directory to create the folder in
 *   - name: The new folder name (no path separators)
 *
 * Returns:
 *   - entry: The created directory entry { name, path, isDirectory }
 */
export const POST = withAuth(async (request) => {
  const result = await parseJsonBody<{ path?: string; name?: string }>(request);
  if ("error" in result) return result.error;

  const { path: rawParent, name: rawName } = result.data;

  // Validate the folder name (no separators, not '.'/'..', reasonable length).
  const name = validateFolderName(rawName ?? "");
  if (!name) {
    return errorResponse("Invalid folder name", 400);
  }

  // Validate the parent path against the browse allowlist.
  if (!rawParent) {
    return errorResponse("Invalid path - must be within allowed directories", 400);
  }
  const parentReal = await validateBrowsePath(rawParent);
  if (!parentReal) {
    return errorResponse("Invalid path - must be within allowed directories", 400);
  }

  // Resolve the target and re-validate it lands inside an allowed prefix.
  const target = resolve(parentReal, name);
  const targetReal = await validateBrowsePath(target);
  if (!targetReal) {
    return errorResponse("Invalid path - must be within allowed directories", 400);
  }

  const fsp = await getFsPromises();

  // Create atomically: mkdir fails with EEXIST when something already exists,
  // which avoids a stat()->mkdir TOCTOU race and yields correct status codes.
  try {
    await fsp.mkdir(target);
    return NextResponse.json({
      entry: { name, path: target, isDirectory: true },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return errorResponse("A folder with that name already exists", 409);
    }
    if (code === "EACCES" || code === "EPERM") {
      return errorResponse("Permission denied", 403);
    }
    log.error("Error creating directory", { error: String(error) });
    return errorResponse("Failed to create folder", 500);
  }
});
