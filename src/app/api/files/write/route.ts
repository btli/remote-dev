import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { validateProjectPath } from "@/lib/api-validation";
import { writeFile, rename, unlink, mkdir } from "fs/promises";
import { dirname } from "path";

const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/files/write
 *
 * Write content to a file. Uses atomic write (temp file + rename)
 * to prevent data corruption on failure.
 *
 * SECURITY: Path must be within the user's home directory or /tmp.
 */
export const POST = withApiAuth(async (request) => {
  const result = await parseJsonBody<{
    path: string;
    content: string;
  }>(request);
  if ("error" in result) return result.error;
  const { path, content } = result.data;

  if (!path) {
    return errorResponse("Missing 'path' field", 400);
  }

  if (typeof content !== "string") {
    return errorResponse("Content must be a string", 400);
  }

  if (content.length > MAX_CONTENT_SIZE) {
    return errorResponse("Content too large. Maximum is 10MB.", 413, "CONTENT_TOO_LARGE");
  }

  const validatedPath = validateProjectPath(path);
  if (!validatedPath) {
    return errorResponse("Invalid file path", 403, "INVALID_PATH");
  }

  // Atomic write: write to temp file, then rename
  const tempPath = `${validatedPath}.tmp.${Date.now()}`;

  try {
    // Ensure parent directory exists
    await mkdir(dirname(validatedPath), { recursive: true });

    await writeFile(tempPath, content, "utf-8");
    await rename(tempPath, validatedPath);

    return NextResponse.json({
      success: true,
      savedAt: new Date().toISOString(),
    });
  } catch (error) {
    // Clean up temp file on failure
    await unlink(tempPath).catch(() => {});

    const err = error as NodeJS.ErrnoException;
    if (err.code === "EACCES") {
      return errorResponse("Permission denied", 403, "PERMISSION_DENIED");
    }
    console.error("Error writing file:", error);
    return errorResponse("Failed to write file", 500);
  }
});
