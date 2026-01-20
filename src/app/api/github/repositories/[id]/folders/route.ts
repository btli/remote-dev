import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";

/**
 * GET /api/github/repositories/:id/folders - Get folder structure of a cloned repository
 */
export const GET = withAuth(async (request, { userId, params }) => {
  const repository = await GitHubService.getRepositoryByIdOrGitHubId(params!.id, userId);

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
