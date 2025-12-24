import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";
import * as WorktreeService from "@/services/worktree-service";

/**
 * Helper to determine if a string is a valid UUID
 */
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * GET /api/github/repositories/:id/branches - Get branches for a repository
 * Accepts either database UUID or GitHub numeric ID
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const id = params!.id;

  let repository: Awaited<ReturnType<typeof GitHubService.getRepository>>;

  if (isUUID(id)) {
    // Look up by database ID
    repository = await GitHubService.getRepository(id, userId);
  } else {
    // Try parsing as GitHub ID (number)
    const githubId = parseInt(id, 10);
    if (isNaN(githubId)) {
      return errorResponse("Invalid repository ID", 400);
    }
    repository = await GitHubService.getRepositoryByGitHubId(githubId, userId);
  }

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
