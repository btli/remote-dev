import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { validateProjectPath } from "@/lib/api-validation";
import { readFile, stat } from "fs/promises";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * GET /api/files/read?path=/absolute/path/to/file
 *
 * Read a file's contents for the file editor.
 * SECURITY: Path must be within the user's home directory or /tmp.
 */
export const GET = withApiAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return errorResponse("Missing 'path' query parameter", 400);
  }

  const validatedPath = validateProjectPath(filePath);
  if (!validatedPath) {
    return errorResponse("Invalid file path", 403, "INVALID_PATH");
  }

  try {
    const stats = await stat(validatedPath);

    if (!stats.isFile()) {
      return errorResponse("Path is not a file", 400, "NOT_A_FILE");
    }

    if (stats.size > MAX_FILE_SIZE) {
      return errorResponse(
        `File too large (${Math.round(stats.size / 1024 / 1024)}MB). Maximum is 10MB.`,
        413,
        "FILE_TOO_LARGE"
      );
    }

    const content = await readFile(validatedPath, "utf-8");

    return NextResponse.json({
      content,
      metadata: {
        size: stats.size,
        modified: stats.mtime.toISOString(),
      },
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return errorResponse("File not found", 404, "NOT_FOUND");
    }
    if (err.code === "EACCES") {
      return errorResponse("Permission denied", 403, "PERMISSION_DENIED");
    }
    console.error("Error reading file:", error);
    return errorResponse("Failed to read file", 500);
  }
});
