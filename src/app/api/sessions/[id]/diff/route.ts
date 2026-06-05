import { randomUUID } from "node:crypto";
import { copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import { getDefaultBranch } from "@/services/worktree-service";
import { execFileNoThrow, execFileCapped } from "@/lib/exec";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sessions/diff");

/** Hard cap on bytes of `git diff` we stream to the client (matches exec maxBuffer). */
const DIFF_BYTE_LIMIT = 10 * 1024 * 1024; // 10MB
/** Wall-clock bound on the git execs. */
const DIFF_TIMEOUT_MS = 30000;
/**
 * `git add -N` stdout is tiny (it prints nothing on success); a small cap is
 * plenty and bounds a pathological untracked tree. stderr is drained+discarded
 * by execFileCapped, so warnings can never overflow a buffer either.
 */
const ADD_STDOUT_CAP = 1 * 1024 * 1024; // 1MB

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
 *
 * [remote-dev-dxpd] `git diff <merge-base>` never includes untracked files, so a
 * worktree whose work is (wholly or partly) NEW files rendered "No changes" (or
 * silently dropped the new files from a mixed review). To include them in the
 * SAME single diff — without spawning a subprocess per file and without ever
 * mutating the agent's real index — we diff through a **throwaway index**:
 *
 *   1. Seed it by COPYING the real index (so anything the agent has STAGED —
 *      including a force-added gitignored file like `git add -f .env` — is
 *      faithfully reviewed; seeding from `read-tree HEAD` would hide such files
 *      because `add -N` then re-applies .gitignore). Falls back to
 *      `read-tree HEAD` / an empty index if the real index can't be resolved.
 *   2. `add -N -- .` — intent-to-add the untracked files (respects
 *      .gitignore/exclude automatically, so node_modules & friends stay out;
 *      symlinks register as mode 120000 and are NOT followed, so no file
 *      content leaks). Bounded by execFileCapped + `-c core.safecrlf=false`
 *      so a pathological tree / CRLF-warning flood can't hang or crash it.
 *   3. `diff <baseRef>` — ONE bounded exec yields tracked changes (working tree
 *      vs baseRef) AND untracked files as `new file` hunks, which
 *      `parseUnifiedDiff` already renders with the `isNew` badge.
 *
 * All git steps run with `GIT_INDEX_FILE` pointed at an absolute temp path
 * (outside the worktree) so the real `.git/index` is untouched; the temp index
 * (and the copy temp) are always removed in `finally`. `truncated`/`bytes` come
 * straight from the single `execFileCapped` diff result.
 *
 * Known limitation: `git rm --cached <f>` (untrack but keep the file on disk)
 * is NOT shown as a deletion — the base→working-tree diff sees the on-disk file
 * unchanged. We intentionally don't add `--cached` plumbing for this rare case.
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

  // Absolute, outside-the-worktree temp index so it can never appear in the
  // diff or collide with the real `.git/index`.
  const tempIndex = join(tmpdir(), `rdv-diff-index-${sessionId}-${randomUUID()}`);
  // Point every child git at the throwaway index (merged over the exec helpers'
  // clean env); `-C cwd` keeps path resolution rooted in the worktree. Spread
  // process.env per the repo convention for git execs (ProcessEnv requires
  // NODE_ENV), then override GIT_INDEX_FILE.
  const indexEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_INDEX_FILE: tempIndex,
  };

  try {
    // (1) Seed the temp index. Prefer COPYING the real index so STAGED changes
    // (incl. force-added gitignored files) are reviewed; fall back to
    // read-tree HEAD / empty index if the real index can't be resolved (e.g.
    // a fresh repo with no commits, or a transient rev-parse failure).
    let seeded = false;
    const idxPath = await execFileNoThrow("git", [
      "-C",
      cwd,
      "rev-parse",
      "--git-path",
      "index",
    ]);
    if (idxPath.exitCode === 0 && idxPath.stdout.trim()) {
      // rev-parse may return the path relative to cwd; make it absolute.
      const raw = idxPath.stdout.trim();
      const realIndex = isAbsolute(raw) ? raw : resolve(cwd, raw);
      try {
        await copyFile(realIndex, tempIndex);
        seeded = true;
      } catch (error) {
        // Real index missing (fresh repo) or unreadable — fall through to HEAD.
        log.debug("Real index copy failed; falling back to read-tree HEAD", {
          sessionId,
          error: String(error),
        });
      }
    }

    if (!seeded) {
      // No real index to copy. Seed from HEAD; in a repo with no commit this
      // also fails (no HEAD) — that's fine: `add -N` still works on the empty
      // index, so we just proceed (the diff then shows untracked files as new).
      const readTree = await execFileNoThrow(
        "git",
        ["-C", cwd, "read-tree", "HEAD"],
        { env: indexEnv },
      );
      if (readTree.exitCode !== 0) {
        log.debug("read-tree HEAD failed; continuing with empty temp index", {
          sessionId,
          exitCode: readTree.exitCode,
        });
      }
    }

    // (2) Intent-to-add untracked files into the TEMP index only. Respects
    // .gitignore/exclude; never touches the real index; no filenames in argv.
    // Bounded (time + a small stdout cap) so a pathological untracked tree
    // can't hang the event loop; `-c core.safecrlf=false` suppresses CRLF
    // warnings an agent could otherwise use to flood stderr / fail the step.
    const addN = await execFileCapped(
      "git",
      ["-C", cwd, "-c", "core.safecrlf=false", "add", "-N", "--", "."],
      { maxBytes: ADD_STDOUT_CAP, timeout: DIFF_TIMEOUT_MS, env: indexEnv },
    ).catch((error: unknown) => {
      log.warn("add -N for untracked files failed; diffing tracked changes only", {
        sessionId,
        error: String(error),
      });
      return null;
    });
    if (addN && addN.exitCode !== 0) {
      // Non-fatal: fall through and diff what we have (worst case: tracked-only,
      // i.e. the pre-fix behavior — never a 500).
      log.warn("add -N exited non-zero; diffing tracked changes only", {
        sessionId,
        exitCode: addN.exitCode,
        truncated: addN.truncated,
      });
    }

    // (3) ONE bounded diff: tracked changes + untracked new-file hunks. Bounded
    // by time + bytes; on overflow we keep the partial body + `truncated`.
    const diff = await execFileCapped("git", ["-C", cwd, "diff", baseRef], {
      maxBytes: DIFF_BYTE_LIMIT,
      timeout: DIFF_TIMEOUT_MS,
      env: indexEnv,
    }).catch((error: unknown) => {
      log.error("git diff failed", { error: String(error), sessionId });
      return null;
    });

    // A hard git failure (e.g. bad/unknown baseRef in a degenerate repo) yields
    // no body — degrade gracefully to an empty diff rather than a 500.
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
  } finally {
    // Always remove the throwaway index (+ any stale lock) — best-effort.
    await rm(tempIndex, { force: true }).catch(() => {});
    await rm(`${tempIndex}.lock`, { force: true }).catch(() => {});
  }
});
