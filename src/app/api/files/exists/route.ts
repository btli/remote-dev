import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { validateProjectPath } from "@/lib/api-validation";
import { stat } from "fs/promises";

/**
 * POST /api/files/exists
 *
 * Check which files from a list of paths exist on disk.
 * Returns a record of path -> boolean.
 * SECURITY: Paths must be within the user's home directory or /tmp.
 */
export const POST = withAuth(async (request) => {
  const body = await request.json();
  const paths: unknown = body.paths;

  if (!Array.isArray(paths) || paths.length === 0) {
    return errorResponse("'paths' must be a non-empty array of strings", 400);
  }

  if (paths.length > 20) {
    return errorResponse("Maximum 20 paths per request", 400);
  }

  const results: Record<string, boolean> = {};

  await Promise.all(
    paths.map(async (p: unknown) => {
      if (typeof p !== "string") return;
      const validated = validateProjectPath(p);
      if (!validated) {
        results[p] = false;
        return;
      }
      try {
        const stats = await stat(validated);
        results[p] = stats.isFile();
      } catch {
        results[p] = false;
      }
    })
  );

  return NextResponse.json({ exists: results });
});
