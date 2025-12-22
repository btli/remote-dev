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
  // If it's a UUID, look up by database ID
  if (isUUID(id)) {
    return GitHubService.getRepository(id, userId);
  }

  // Otherwise, try parsing as a GitHub ID (number)
  const githubId = parseInt(id, 10);
  if (!isNaN(githubId)) {
    return GitHubService.getRepositoryByGitHubId(githubId, userId);
  }

  return null;
}

/**
 * GET /api/github/repositories/:id - Get a single repository
 * Accepts either database UUID or GitHub numeric ID
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

    return NextResponse.json(repository);
  } catch (error) {
    console.error("Error getting repository:", error);
    return NextResponse.json(
      { error: "Failed to get repository" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/github/repositories/:id - Clone repository to local cache
 * Accepts either database UUID or GitHub numeric ID
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessToken = await GitHubService.getAccessToken(session.user.id);
    if (!accessToken) {
      return NextResponse.json(
        { error: "GitHub not connected" },
        { status: 400 }
      );
    }

    const { id } = await params;
    const repository = await getRepositoryByIdOrGitHubId(id, session.user.id);

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    // Clone the repository
    const result = await GitHubService.cloneRepository(
      accessToken,
      repository.fullName
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Clone failed" },
        { status: 500 }
      );
    }

    // Update the local path in database using the database ID
    await GitHubService.updateLocalPath(repository.id, result.localPath);

    return NextResponse.json({
      success: true,
      localPath: result.localPath,
      // Return database ID so it can be used as foreign key in session creation
      repositoryId: repository.id,
    });
  } catch (error) {
    console.error("Error cloning repository:", error);
    return NextResponse.json(
      { error: "Failed to clone repository" },
      { status: 500 }
    );
  }
}
