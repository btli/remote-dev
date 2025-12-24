import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { isGitRepo, getBranches } from "@/services/worktree-service";

/**
 * GET /api/git/validate - Validate if a path is a git repository
 * Query params:
 *   - path: The filesystem path to validate
 * Returns:
 *   - isGitRepo: boolean
 *   - branches: string[] (local branch names, if it's a git repo)
 */
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path");

  if (!path) {
    return errorResponse("Path required", 400);
  }

  const isRepo = await isGitRepo(path);
  if (!isRepo) {
    return NextResponse.json({ isGitRepo: false });
  }

  const branches = await getBranches(path);
  const branchNames = branches
    .filter((b) => !b.isRemote)
    .map((b) => b.name);

  return NextResponse.json({
    isGitRepo: true,
    branches: branchNames,
  });
});
