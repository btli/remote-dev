import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";

/**
 * GET /api/github/repositories - List user's GitHub repositories
 */
export const GET = withAuth(async (request, { userId }) => {
  try {
    const accessToken = await GitHubService.getAccessToken(userId);
    if (!accessToken) {
      return errorResponse("GitHub not connected", 400, "GITHUB_NOT_CONNECTED");
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const perPage = parseInt(searchParams.get("perPage") || "100", 10);
    const sort = (searchParams.get("sort") || "updated") as
      | "updated"
      | "created"
      | "pushed"
      | "full_name";

    const repositories = await GitHubService.listRepositoriesFromAPI(
      accessToken,
      page,
      perPage,
      sort
    );

    // Cache repositories in database
    await Promise.all(
      repositories.map((repo) =>
        GitHubService.cacheRepository(userId, repo)
      )
    );

    // Transform to simpler format for frontend
    const repos = repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      description: repo.description,
      language: repo.language,
      stargazersCount: repo.stargazers_count,
      forksCount: 0, // GitHub API doesn't always return this in user repos endpoint
      updatedAt: repo.updated_at,
      owner: {
        login: repo.owner.login,
        avatarUrl: repo.owner.avatar_url,
      },
    }));

    return NextResponse.json({
      repositories: repos,
      page,
      hasMore: repos.length === perPage,
    });
  } catch (error) {
    console.error("Error listing GitHub repositories:", error);

    if (error instanceof GitHubService.GitHubServiceError) {
      return errorResponse(error.message, error.statusCode || 500, error.code);
    }

    return errorResponse("Failed to list repositories", 500);
  }
});
