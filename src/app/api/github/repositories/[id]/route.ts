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
export const GET = withAuth(async (_request, { userId, params }) => {
  const repository = await getRepositoryByIdOrGitHubId(params!.id, userId);

  if (!repository) {
    return errorResponse("Repository not found", 404);
  }

  return NextResponse.json(repository);
});

/**
 * POST /api/github/repositories/:id - Clone repository to local cache
 * Accepts either database UUID or GitHub numeric ID
 *
 * Optional body:
 * - targetPath: Custom directory to clone into (default: ~/.remote-dev/repos/{owner}/{repo})
 */
export const POST = withAuth(async (request, { userId, params }) => {
  const accessToken = await GitHubService.getAccessToken(userId);
  if (!accessToken) {
    return errorResponse("GitHub not connected", 400);
  }

  const repository = await getRepositoryByIdOrGitHubId(params!.id, userId);

  if (!repository) {
    return errorResponse("Repository not found", 404);
  }

  // Parse optional body for custom target path
  let targetPath: string | undefined;
  try {
    const body = await request.json();
    if (body.targetPath && typeof body.targetPath === "string") {
      targetPath = body.targetPath;
    }
  } catch {
    // No body or invalid JSON - use default path
  }

  // Clone the repository
  const result = await GitHubService.cloneRepository(
    accessToken,
    repository.fullName,
    targetPath
  );

  if (!result.success) {
    return errorResponse(result.error || "Clone failed", 500);
  }

  // Update the local path in database using the database ID
  await GitHubService.updateLocalPath(repository.id, result.localPath);

  return NextResponse.json({
    success: true,
    localPath: result.localPath,
    // Return database ID so it can be used as foreign key in session creation
    repositoryId: repository.id,
  });
});
