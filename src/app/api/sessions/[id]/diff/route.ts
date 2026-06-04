import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import { getDefaultBranch } from "@/services/worktree-service";
import { execFileNoThrow, execFileCapped } from "@/lib/exec";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sessions/diff");

/** Hard cap on bytes of `git diff` we stream to the client (matches exec maxBuffer). */
const DIFF_BYTE_LIMIT = 10 * 1024 * 1024; // 10MB
/** Wall-clock bound on the `git diff` exec. */
const DIFF_TIMEOUT_MS = 30000;

/**
 * GET /api/sessions/:id/diff — [n6uc.6]
 *
 * Returns the raw `git diff` of the session's worktree (branch + uncommitted
 * changes) against its merge-base with the repo's default branch, so a reviewer
 * sees exactly what the agent has done on this branch.
 *
 * [n6uc.9] The diff exec is bounded by time + bytes. If the diff exceeds the
 * byte cap (or times out), the response carries `truncated: true` with the
 * partial body so the viewer can show a "diff too large" notice instead of
 * trying to render a ~10MB DOM. Shape: `{ raw, base, truncated, bytes, limit }`.
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
  if (!cwd) {
    return NextResponse.json({ raw: "", base: null, truncated: false });
  }

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

  // Bounded exec: never buffer more than DIFF_BYTE_LIMIT and never run longer
  // than DIFF_TIMEOUT_MS. On overflow we keep the partial diff + a `truncated`
  // flag rather than failing or shipping an unbounded body.
  const diff = await execFileCapped("git", ["-C", cwd, "diff", baseRef], {
    maxBytes: DIFF_BYTE_LIMIT,
    timeout: DIFF_TIMEOUT_MS,
  }).catch((error: unknown) => {
    log.error("git diff failed", { error: String(error), sessionId });
    return null;
  });

  if (!diff || (diff.exitCode !== 0 && !diff.truncated)) {
    return NextResponse.json({ raw: "", base: baseRef, truncated: false });
  }

  if (diff.truncated) {
    log.warn("Diff exceeded byte/time cap; returning truncated body", {
      sessionId,
      bytes: diff.bytes,
      limit: DIFF_BYTE_LIMIT,
    });
  }

  return NextResponse.json({
    raw: diff.stdout,
    base: baseRef,
    truncated: diff.truncated,
    ...(diff.truncated ? { bytes: diff.bytes, limit: DIFF_BYTE_LIMIT } : {}),
  });
});
