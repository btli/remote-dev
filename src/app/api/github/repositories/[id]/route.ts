import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";

/**
 * GET /api/github/repositories/:id - Get a single repository
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) return errorResponse("Repository ID required", 400);

    const repository = await GitHubService.getRepository(id, userId);

    if (!repository) {
      return errorResponse("Repository not found", 404);
    }

    return NextResponse.json(repository);
  } catch (error) {
    console.error("Error getting repository:", error);
    return errorResponse("Failed to get repository", 500);
  }
});

/**
 * POST /api/github/repositories/:id - Clone repository to local cache
 */
export const POST = withAuth(async (_request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) return errorResponse("Repository ID required", 400);

    const accessToken = await GitHubService.getAccessToken(userId);
    if (!accessToken) {
      return errorResponse("GitHub not connected", 400);
    }

    const repository = await GitHubService.getRepository(id, userId);

    if (!repository) {
      return errorResponse("Repository not found", 404);
    }

    // Clone the repository
    const result = await GitHubService.cloneRepository(
      accessToken,
      repository.fullName
    );

    if (!result.success) {
      return errorResponse(result.error || "Clone failed", 500);
    }

    // Update the local path in database
    await GitHubService.updateLocalPath(id, result.localPath);

    return NextResponse.json({
      success: true,
      localPath: result.localPath,
    });
  } catch (error) {
    console.error("Error cloning repository:", error);
    return errorResponse("Failed to clone repository", 500);
  }
});
