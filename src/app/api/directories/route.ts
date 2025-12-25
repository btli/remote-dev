import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { resolve, sep } from "path";
import { readdir, stat, access, realpath } from "fs/promises";
import { constants } from "fs";

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * Validate and resolve a path for directory browsing
 *
 * SECURITY:
 * - Uses realpath() to resolve symlinks before validation (prevents /var -> /private/var bypass)
 * - Requires exact prefix match with path separator (prevents /Users-evil bypass)
 * - Only allows paths within HOME, /tmp, or common user directories
 */
async function validateBrowsePath(inputPath: string): Promise<string | null> {
  if (!inputPath) return null;

  try {
    // First resolve the path normally
    const resolved = resolve(inputPath);

    // Then resolve symlinks to get the real path
    // This prevents bypasses like /var -> /private/var on macOS
    let realPath: string;
    try {
      realPath = await realpath(resolved);
    } catch {
      // If realpath fails (path doesn't exist), use resolved path
      // The existence check later will handle non-existent paths
      realPath = resolved;
    }

    const home = process.env.HOME || "/tmp";

    // Allow paths within home, /tmp, or common development roots
    // Note: On macOS, /var is a symlink to /private/var, so we include /private/var
    const allowedPrefixes = [
      home,
      "/tmp",
      "/private/tmp",  // macOS realpath for /tmp
      "/Users",
      "/home",
      "/private/var",  // macOS realpath for /var
    ];

    // SECURITY: Check that path equals prefix OR starts with prefix + separator
    // This prevents bypasses like /Users-evil or /home-hack
    const isAllowed = allowedPrefixes.some(prefix =>
      realPath === prefix || realPath.startsWith(prefix + sep)
    );

    if (!isAllowed) {
      return null;
    }

    return realPath;
  } catch {
    return null;
  }
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

  // Check if path exists and is accessible
  try {
    await access(validatedPath, constants.R_OK);
  } catch {
    return errorResponse("Path does not exist or is not accessible", 404);
  }

  try {
    const pathStat = await stat(validatedPath);
    if (!pathStat.isDirectory()) {
      return errorResponse("Path is not a directory", 400);
    }

    const rawEntries = await readdir(validatedPath);
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
        const entryStat = await stat(fullPath);
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
    console.error("Error reading directory:", error);
    return errorResponse("Failed to read directory", 500);
  }
});
