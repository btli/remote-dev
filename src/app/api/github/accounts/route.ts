import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { listGitHubAccountsUseCase } from "@/infrastructure/container";

/**
 * GET /api/github/accounts
 * List all linked GitHub accounts for the authenticated user
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const result = await listGitHubAccountsUseCase.execute(userId);

    return NextResponse.json({
      accounts: result.accounts.map((a) => {
        // Strip configDir (server-side path) from client response
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { configDir, ...rest } = a.toPlainObject();
        return rest;
      }),
      folderBindings: Object.fromEntries(result.folderBindings),
    });
  } catch (error) {
    console.error("[api/github/accounts] Error listing accounts:", error);
    return errorResponse("Failed to list GitHub accounts", 500);
  }
});
