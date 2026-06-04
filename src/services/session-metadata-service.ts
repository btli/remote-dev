/**
 * [n6uc] Session metadata aggregator.
 *
 * Consolidates the per-session observability signals previously scattered across
 * the `git-status` route, the `port-monitoring-service`, the `githubPullRequests`
 * cache, and the y5ch notification severity model into ONE payload
 * (`SessionMetadata`) served by `GET /api/sessions/:id/metadata` and pushed live
 * over the terminal-server WebSocket.
 *
 * Pure parsing/mapping helpers are exported separately so they can be unit
 * tested without shelling out to git/lsof.
 */

import { execFileNoThrow } from "@/lib/exec";
import { createLogger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { githubPullRequests } from "@/db/schema";
import * as SessionService from "@/services/session-service";
import * as GitHubService from "@/services/github-service";
import { getListeningPorts } from "@/services/port-monitoring-service";
import { isPortProxyable } from "@/lib/proxy-port-utils";
import { deriveAttention } from "@/services/session-metadata-service-attention";
import {
  attributePortsToPids,
  mapCachedPrToStatus,
  parseAheadBehind,
  parseGitStatusPorcelain,
} from "@/services/session-metadata-parsers";
import type {
  SessionGitStatus,
  SessionMetadata,
  SessionPortInfo,
  SessionPrStatus,
} from "@/types/session-metadata";

const log = createLogger("SessionMetadataService");

// Re-export the pure helpers so existing importers keep one entry point. The
// implementations live in `session-metadata-parsers` (DB-free, unit-tested).
export {
  attributePortsToPids,
  mapCachedPrToStatus,
  parseAheadBehind,
  parseGitStatusPorcelain,
};

// ============================================================================
// Git status (branch + ahead/behind + dirty count)
// ============================================================================

/** Compute branch + ahead/behind + dirty count for a worktree path. */
export async function getGitStatus(
  cwd: string,
): Promise<SessionGitStatus | null> {
  const branchRes = await execFileNoThrow("git", [
    "-C",
    cwd,
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  if (branchRes.exitCode !== 0) return null; // not a git repo
  const branch = branchRes.stdout.trim() || null;

  const [abRes, statusRes] = await Promise.all([
    execFileNoThrow("git", [
      "-C",
      cwd,
      "rev-list",
      "--left-right",
      "--count",
      "@{u}...HEAD",
    ]),
    execFileNoThrow("git", ["-C", cwd, "status", "--porcelain"]),
  ]);

  const { behind, ahead } =
    abRes.exitCode === 0
      ? parseAheadBehind(abRes.stdout)
      : { behind: 0, ahead: 0 };
  const dirtyCount =
    statusRes.exitCode === 0 ? parseGitStatusPorcelain(statusRes.stdout) : 0;

  return { branch, ahead, behind, dirtyCount };
}

// ============================================================================
// Linked PR (cache-first via githubPullRequests, live GitHub fallback)
// ============================================================================

/**
 * Find the PR for a session's worktree branch — cache first (rich:
 * review/CI/draft), GitHub API fallback (number/state/url/draft only).
 */
export async function getPrStatus(
  userId: string,
  githubRepoId: string | null,
  worktreeBranch: string | null,
): Promise<SessionPrStatus | null> {
  if (!githubRepoId || !worktreeBranch) return null;

  // 1) Cache hit. githubPullRequests.repositoryId references the cached repo row
  //    by its internal id, and `branch` is the PR head ref.
  const cached = await db.query.githubPullRequests.findFirst({
    where: and(
      eq(githubPullRequests.repositoryId, githubRepoId),
      eq(githubPullRequests.branch, worktreeBranch),
    ),
  });
  if (cached) return mapCachedPrToStatus(cached);

  // 2) Fallback: live lookup (mirrors the legacy git-status route behaviour).
  try {
    const token = await GitHubService.getAccessToken(userId);
    if (!token) return null;
    const repo = await GitHubService.getRepository(githubRepoId, userId);
    if (!repo) return null;
    const [owner, name] = repo.fullName.split("/");
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls?head=${owner}:${worktreeBranch}&state=all&per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) return null;
    const prs = (await res.json()) as Array<{
      number: number;
      state: string;
      html_url: string;
      draft?: boolean;
    }>;
    if (prs.length === 0) return null;
    // GitHub's `state` is "open" | "closed"; "merged" only shows on the detail
    // endpoint. Narrow to PRState (closed-but-merged is rare in this fallback;
    // the cache path carries the precise state).
    const liveState: SessionPrStatus["state"] =
      prs[0].state === "closed" ? "closed" : "open";
    return {
      number: prs[0].number,
      state: liveState,
      url: prs[0].html_url,
      isDraft: !!prs[0].draft,
      reviewDecision: null,
      ciStatus: null,
    };
  } catch (err) {
    log.debug("PR live fallback failed", {
      error: String(err),
      githubRepoId,
    });
    return null;
  }
}

// ============================================================================
// Per-session listening ports (PID-subtree ∩ getListeningPorts)
// ============================================================================

/** Collect the descendant PID set of a root pid via `pgrep -P` BFS (bounded). */
async function collectSubtreePids(rootPid: number): Promise<Set<number>> {
  const seen = new Set<number>([rootPid]);
  let frontier = [rootPid];
  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const pid of frontier) {
      const res = await execFileNoThrow("pgrep", ["-P", String(pid)]);
      if (res.exitCode !== 0) continue;
      for (const line of res.stdout.split("\n")) {
        const child = parseInt(line.trim(), 10);
        if (Number.isFinite(child) && !seen.has(child)) {
          seen.add(child);
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/** Resolve the tmux pane pid(s) for a session, then its listening ports. */
export async function getSessionPorts(
  tmuxSessionName: string,
): Promise<SessionPortInfo[]> {
  const paneRes = await execFileNoThrow("tmux", [
    "list-panes",
    "-t",
    tmuxSessionName,
    "-F",
    "#{pane_pid}",
  ]);
  if (paneRes.exitCode !== 0) return [];
  const rootPids = paneRes.stdout
    .split("\n")
    .map((l) => parseInt(l.trim(), 10))
    .filter(Number.isFinite);
  if (rootPids.length === 0) return [];

  const pidSet = new Set<number>();
  for (const root of rootPids) {
    for (const pid of await collectSubtreePids(root)) pidSet.add(pid);
  }

  const listening = await getListeningPorts();
  // Only surface ports that the existing in-pod port-proxy (src/app/proxy/...)
  // will actually serve: `isPortProxyable` drops privileged (<1024) and the
  // hard-blocked 6001/6002 instance ports. This keeps quick-open honest (no
  // chip that would 403) and is defense-in-depth alongside the proxy's own gate.
  return attributePortsToPids(listening, pidSet).filter((p) =>
    isPortProxyable(p.port),
  );
}

// ============================================================================
// Aggregator
// ============================================================================

/** Aggregate git + PR + ports + attention for a session the user owns. */
export async function getSessionMetadata(
  sessionId: string,
  userId: string,
): Promise<SessionMetadata | null> {
  const session = await SessionService.getSession(sessionId, userId);
  if (!session) return null;

  const cwd = session.projectPath;
  const [git, pr, ports, attention] = await Promise.all([
    cwd ? getGitStatus(cwd) : Promise.resolve(null),
    getPrStatus(userId, session.githubRepoId, session.worktreeBranch),
    getSessionPorts(session.tmuxSessionName),
    deriveAttention(userId, sessionId, session.agentActivityStatus ?? null),
  ]);

  return {
    sessionId,
    git,
    pr,
    ports,
    lastActivityAt: session.lastActivityAt
      ? new Date(session.lastActivityAt).toISOString()
      : null,
    attention,
  };
}
