import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/github/worktrees - Create a git worktree for a branch
 *
 * Accepts either:
 * - repositoryId: Looks up the repo from database (legacy)
 * - projectPath: Uses the path directly if it's a valid git repo (preferred)
 *
 * Proxies to rdv-server /worktrees.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, { path: "/worktrees" });
});

/**
 * DELETE /api/github/worktrees - Remove a git worktree
 *
 * Accepts either:
 * - repositoryId: Looks up the repo from database (legacy)
 * - projectPath: Uses the path directly to find the main repo (preferred)
 *
 * Proxies to rdv-server /worktrees.
 */
export const DELETE = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, { path: "/worktrees" });
});
