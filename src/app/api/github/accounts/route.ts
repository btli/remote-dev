import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { listGitHubAccountsUseCase } from "@/infrastructure/container";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/github");

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
    log.error("Error listing accounts", { error: String(error) });
    return errorResponse("Failed to list GitHub accounts", 500);
  }
});
