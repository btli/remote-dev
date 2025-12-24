import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";

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
export const GET = withAuth(async (request, { userId, params }) => {
  const repository = await getRepositoryByIdOrGitHubId(params!.id, userId);

  if (!repository) {
    return errorResponse("Repository not found", 404);
  }

  if (!repository.localPath) {
    return errorResponse("Repository not cloned", 400, "NOT_CLONED");
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
});
