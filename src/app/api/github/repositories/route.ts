import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as GitHubService from "@/services/github-service";

/**
 * GET /api/github/repositories - List user's GitHub repositories
 */
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessToken = await GitHubService.getAccessToken(session.user.id);
    if (!accessToken) {
      return NextResponse.json(
        { error: "GitHub not connected", code: "GITHUB_NOT_CONNECTED" },
        { status: 400 }
      );
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

    const userId = session.user.id;

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
    console.error("Error listing GitHub repositories:", error);

    if (error instanceof GitHubService.GitHubServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode || 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to list repositories" },
      { status: 500 }
    );
  }
}
