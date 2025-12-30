import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { markIssuesSeenUseCase } from "@/infrastructure/container";

/**
 * POST /api/github/issues/mark-seen - Mark issues as seen
 *
 * Body:
 * - repositoryId: string (required) - Repository ID
 * - issueNumber?: number (optional) - Specific issue number to mark
 *
 * If issueNumber is not provided, all issues in the repository are marked as seen.
 */
export const POST = withApiAuth(async (request) => {
  try {
    const body = await request.json();
    const { repositoryId, issueNumber } = body;

    if (!repositoryId) {
      return errorResponse("Repository ID is required", 400, "REPO_ID_REQUIRED");
    }

    const result = await markIssuesSeenUseCase.execute({
      repositoryId,
      issueNumber,
    });

    return NextResponse.json({
      success: result.success,
      markedCount: result.markedCount,
    });
  } catch (error) {
    console.error("Error marking issues as seen:", error);
    return errorResponse("Failed to mark issues as seen", 500);
  }
});
