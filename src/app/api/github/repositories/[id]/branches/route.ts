import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";
import * as WorktreeService from "@/services/worktree-service";

/**
 * GET /api/github/repositories/:id/branches - Get branches for a repository
 * Accepts either database UUID or GitHub numeric ID
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const repository = await GitHubService.getRepositoryByIdOrGitHubId(params!.id, userId);

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
});
