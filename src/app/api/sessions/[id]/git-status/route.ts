import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import * as GitHubService from "@/services/github-service";
import { execFile } from "@/lib/exec";

interface GitStatusResponse {
  branch: string | null;
  ahead: number;
  behind: number;
  pr: { number: number; state: string; url: string } | null;
}

/**
 * GET /api/sessions/:id/git-status - Get git branch, ahead/behind, and PR status
 *
 * Returns branch name, ahead/behind counts relative to upstream, and
 * associated PR info (if the session has a worktree branch and GitHub is connected).
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const sessionId = params?.id;
  if (!sessionId) {
    return errorResponse("Session ID is required", 400, "ID_REQUIRED");
  }

  const session = await SessionService.getSession(sessionId, userId);
  if (!session) {
    return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");
  }

  const result: GitStatusResponse = {
    branch: null,
    ahead: 0,
    behind: 0,
    pr: null,
  };

  const projectPath = session.projectPath;
  if (!projectPath) {
    return NextResponse.json(result);
  }

  // Get current branch name
  try {
    const branchResult = await execFile(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: projectPath }
    );
    result.branch = branchResult.stdout || null;
  } catch {
    // Not a git repo or git not available
    return NextResponse.json(result);
  }

  // Get ahead and behind counts in parallel
  const [aheadResult, behindResult] = await Promise.all([
    execFile("git", ["rev-list", "--count", "@{u}..HEAD"], { cwd: projectPath }).catch(() => null),
    execFile("git", ["rev-list", "--count", "HEAD..@{u}"], { cwd: projectPath }).catch(() => null),
  ]);
  result.ahead = aheadResult ? parseInt(aheadResult.stdout, 10) || 0 : 0;
  result.behind = behindResult ? parseInt(behindResult.stdout, 10) || 0 : 0;

  // Look up PR for this branch if we have a worktree branch and GitHub repo
  if (session.worktreeBranch && session.githubRepoId) {
    try {
      const accessToken = await GitHubService.getAccessToken(userId);
      if (accessToken) {
        const repo = await GitHubService.getRepository(
          session.githubRepoId,
          userId
        );
        if (repo) {
          const [owner, repoName] = repo.fullName.split("/");
          // Search for PRs with matching head branch
          const response = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/pulls?head=${owner}:${session.worktreeBranch}&state=all&per_page=1`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            }
          );
          if (response.ok) {
            const prs = (await response.json()) as Array<{
              number: number;
              state: string;
              html_url: string;
            }>;
            if (prs.length > 0) {
              result.pr = {
                number: prs[0].number,
                state: prs[0].state,
                url: prs[0].html_url,
              };
            }
          }
        }
      }
    } catch {
      // GitHub integration not available - pr stays null
    }
  }

  return NextResponse.json(result);
});
