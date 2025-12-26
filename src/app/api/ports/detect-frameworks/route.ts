import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { detectFrameworks } from "@/services/framework-detection-service";
import { promises as fs } from "fs";
import path from "path";

/**
 * POST /api/ports/detect-frameworks
 * Detect frameworks in a project directory
 *
 * Body: { workingDirectory: string }
 * Returns: { frameworks: DetectedFramework[] }
 */
export const POST = withAuth(async (request) => {
  const body = await request.json();
  const { workingDirectory } = body;

  if (!workingDirectory || typeof workingDirectory !== "string") {
    return errorResponse("workingDirectory is required", 400);
  }

  // Validate the path exists and is a directory
  try {
    const stat = await fs.stat(workingDirectory);
    if (!stat.isDirectory()) {
      return errorResponse("workingDirectory must be a directory", 400);
    }
  } catch {
    return errorResponse("workingDirectory does not exist", 400);
  }

  // Ensure path is absolute
  const absolutePath = path.isAbsolute(workingDirectory)
    ? workingDirectory
    : path.resolve(workingDirectory);

  const frameworks = await detectFrameworks(absolutePath);

  return NextResponse.json({ frameworks });
});
