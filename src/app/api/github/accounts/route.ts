import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { listGitHubAccountsUseCase, githubAccountRepository } from "@/infrastructure/container";
import { createLogger } from "@/lib/logger";
import { isMissingRequiredScopes } from "@/lib/github-scopes";

const log = createLogger("api/github");

/**
 * GET /api/github/accounts
 * List all linked GitHub accounts for the authenticated user
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const [result, scopeMap] = await Promise.all([
      listGitHubAccountsUseCase.execute(userId),
      githubAccountRepository.getAccountScopes(userId),
    ]);

    return NextResponse.json({
      accounts: result.accounts.map((a) => {
        // Strip configDir (server-side path) from client response
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { configDir, ...rest } = a.toPlainObject();
        const needsReauth = isMissingRequiredScopes(
          scopeMap.get(a.providerAccountId) ?? null
        );
        return { ...rest, needsReauth };
      }),
      folderBindings: Object.fromEntries(result.folderBindings),
    });
  } catch (error) {
    log.error("Error listing accounts", { error: String(error) });
    return errorResponse("Failed to list GitHub accounts", 500);
  }
});
