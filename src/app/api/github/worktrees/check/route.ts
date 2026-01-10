import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/github/worktrees/check - Check worktree status (uncommitted changes, branch)
 *
 * Proxies to rdv-server /worktrees/check.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, { path: "/worktrees/check" });
});
