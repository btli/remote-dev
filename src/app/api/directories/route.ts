import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { resolve } from "path";
import { readdirSync, statSync, existsSync } from "fs";

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * Validate and resolve a path for directory browsing
 * Security: Only allow paths within HOME, /tmp, or common root directories
 */
function validateBrowsePath(path: string): string | null {
  if (!path) return null;

  const resolved = resolve(path);
  const home = process.env.HOME || "/tmp";

  // Allow paths within home, /tmp, or common development roots
  const allowedPrefixes = [
    home,
    "/tmp",
    "/Users",  // macOS
    "/home",   // Linux
    "/var",    // For some dev setups
  ];

  if (!allowedPrefixes.some(prefix => resolved.startsWith(prefix))) {
    return null;
  }

  return resolved;
}

/**
 * GET /api/directories - List contents of a directory
 * Query params:
 *   - path: The filesystem path to browse (defaults to HOME)
 *   - showHidden: Whether to show hidden files (default: false)
 *   - dirsOnly: Whether to show only directories (default: true)
 * Returns:
 *   - path: Current path
 *   - parent: Parent path (null if at root of allowed area)
 *   - entries: Array of directory entries
 */
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get("path") || process.env.HOME || "/tmp";
  const showHidden = searchParams.get("showHidden") === "true";
  const dirsOnly = searchParams.get("dirsOnly") !== "false";

  const path = validateBrowsePath(rawPath);
  if (!path) {
    return errorResponse("Invalid path - must be within allowed directories", 400);
  }

  if (!existsSync(path)) {
    return errorResponse("Path does not exist", 404);
  }

  try {
    const stat = statSync(path);
    if (!stat.isDirectory()) {
      return errorResponse("Path is not a directory", 400);
    }

    const rawEntries = readdirSync(path);
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

      const fullPath = resolve(path, name);
      try {
        const entryStat = statSync(fullPath);
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
    const parent = resolve(path, "..");
    const validParent = validateBrowsePath(parent);

    return NextResponse.json({
      path,
      parent: validParent !== path ? validParent : null,
      entries,
    });
  } catch (error) {
    console.error("Error reading directory:", error);
    return errorResponse("Failed to read directory", 500);
  }
});
