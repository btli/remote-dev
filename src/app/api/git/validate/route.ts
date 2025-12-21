import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isGitRepo, getBranches } from "@/services/worktree-service";

/**
 * GET /api/git/validate - Validate if a path is a git repository
 * Query params:
 *   - path: The filesystem path to validate
 * Returns:
 *   - isGitRepo: boolean
 *   - branches: string[] (local branch names, if it's a git repo)
 */
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json({ error: "Path required" }, { status: 400 });
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
  } catch (error) {
    console.error("Error validating git repo:", error);
    return NextResponse.json(
      { error: "Failed to validate path" },
      { status: 500 }
    );
  }
}
