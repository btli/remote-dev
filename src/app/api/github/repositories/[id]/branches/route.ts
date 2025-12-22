import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";
import * as WorktreeService from "@/services/worktree-service";

/**
 * GET /api/github/repositories/:id/branches - Get branches for a repository
 * Note: :id is the GitHub repository ID (number), not the internal database ID
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) return errorResponse("Repository ID required", 400);

    const githubId = parseInt(id, 10);

    if (isNaN(githubId)) {
      return errorResponse("Invalid repository ID", 400);
    }

    const repository = await GitHubService.getRepositoryByGitHubId(githubId, userId);

    if (!repository) {
      return errorResponse("Repository not found", 404);
    }

    // If we have a local path, get branches from the local repo
    if (repository.localPath) {
      const branches = await WorktreeService.getBranches(repository.localPath);
      return NextResponse.json({ branches });
    }

    // Otherwise, fetch from GitHub API
    const accessToken = await GitHubService.getAccessToken(userId);
    if (!accessToken) {
      return errorResponse("GitHub not connected", 400);
    }

    const [owner, repo] = repository.fullName.split("/");
    const apiBranches = await GitHubService.listBranchesFromAPI(
      accessToken,
      owner,
      repo
    );

    const branches = apiBranches.map((b) => ({
      name: b.name,
      isRemote: false,
      isDefault: b.name === repository.defaultBranch,
    }));

    return NextResponse.json({ branches });
  } catch (error) {
    console.error("Error listing branches:", error);
    return errorResponse("Failed to list branches", 500);
  }
});
