import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { detectRuntime } from "@/services/framework-detection-service";
import { promises as fs } from "fs";
import path from "path";

/**
 * POST /api/ports/detect-runtime
 * Detect runtime/package manager in a project directory
 *
 * Body: { workingDirectory: string }
 * Returns: { runtime: DetectedRuntime }
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

  const runtime = await detectRuntime(absolutePath);

  return NextResponse.json({ runtime });
});
