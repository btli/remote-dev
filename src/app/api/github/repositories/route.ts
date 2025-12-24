import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";

/**
 * GET /api/github/repositories - List user's GitHub repositories
 *
 * Query params:
 * - cached=true: Return only locally cached/cloned repositories from database
 * - page, perPage, sort: Pagination and sorting for API fetch
 */
export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const cached = searchParams.get("cached") === "true";

  try {
    // If cached=true, return only locally cached repos from database
    if (cached) {
      const cachedRepos = await GitHubService.getCachedRepositories(userId);
      const repos = cachedRepos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.fullName,
        localPath: repo.localPath,
        defaultBranch: repo.defaultBranch,
        isPrivate: repo.isPrivate,
      }));

      return NextResponse.json({
        repositories: repos,
        cached: true,
      });
    }

    // Otherwise, fetch from GitHub API
    const accessToken = await GitHubService.getAccessToken(userId);
    if (!accessToken) {
      return errorResponse("GitHub not connected", 400, "GITHUB_NOT_CONNECTED");
    }

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

    // Cache repositories in database and get the cached versions with database IDs
    const cachedRepos = await Promise.all(
      repositories.map((repo) =>
        GitHubService.cacheRepository(userId, repo)
      )
    );

    // Create a map of GitHub ID to database ID for lookup
    const githubIdToDbId = new Map(
      cachedRepos.map((cached) => [cached.githubId, cached.id])
    );

    // Transform to simpler format for frontend, using database IDs
    const repos = repositories.map((repo) => ({
      id: githubIdToDbId.get(repo.id) || String(repo.id), // Use database ID
      githubId: repo.id, // Keep GitHub ID for reference
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
    if (error instanceof GitHubService.GitHubServiceError) {
      return errorResponse(error.message, error.statusCode || 500, error.code);
    }
    throw error;
  }
});
