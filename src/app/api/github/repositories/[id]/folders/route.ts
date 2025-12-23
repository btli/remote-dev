import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import * as GitHubService from "@/services/github-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Helper to determine if a string is a valid UUID
 */
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Helper to get repository by either database UUID or GitHub ID
 */
async function getRepositoryByIdOrGitHubId(
  id: string,
  userId: string
): Promise<Awaited<ReturnType<typeof GitHubService.getRepository>>> {
  if (isUUID(id)) {
    return GitHubService.getRepository(id, userId);
  }

  const githubId = parseInt(id, 10);
  if (!isNaN(githubId)) {
    return GitHubService.getRepositoryByGitHubId(githubId, userId);
  }

  return null;
}

/**
 * GET /api/github/repositories/:id/folders - Get folder structure of a cloned repository
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const repository = await getRepositoryByIdOrGitHubId(id, session.user.id);

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    if (!repository.localPath) {
      return NextResponse.json(
        { error: "Repository not cloned", code: "NOT_CLONED" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const maxDepth = parseInt(searchParams.get("maxDepth") || "3", 10);

    const folders = GitHubService.getFolderStructure(
      repository.localPath,
      maxDepth
    );

    return NextResponse.json({
      folders,
      rootPath: repository.localPath,
    });
  } catch (error) {
    console.error("Error getting folder structure:", error);
    return NextResponse.json(
      { error: "Failed to get folder structure" },
      { status: 500 }
    );
  }
}
