import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import { getDefaultBranch } from "@/services/worktree-service";
import { execFileNoThrow } from "@/lib/exec";

/**
 * GET /api/sessions/:id/diff — [n6uc.6]
 *
 * Returns the raw `git diff` of the session's worktree (branch + uncommitted
 * changes) against its merge-base with the repo's default branch, so a reviewer
 * sees exactly what the agent has done on this branch.
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
  const cwd = session.projectPath;
  if (!cwd) return NextResponse.json({ raw: "", base: null });

  const base = await getDefaultBranch(cwd).catch(() => "main");
  // merge-base diff: everything on this branch + working tree vs the base point.
  const mb = await execFileNoThrow("git", [
    "-C",
    cwd,
    "merge-base",
    "HEAD",
    base,
  ]);
  const baseRef = mb.exitCode === 0 && mb.stdout.trim() ? mb.stdout.trim() : base;
  const diff = await execFileNoThrow("git", ["-C", cwd, "diff", baseRef]);
  if (diff.exitCode !== 0) return NextResponse.json({ raw: "", base: baseRef });
  return NextResponse.json({ raw: diff.stdout, base: baseRef });
});
