/**
 * [n6uc] Pure parsing/mapping helpers for the session-metadata aggregator.
 *
 * These are side-effect-free and import NO infrastructure (no `@/db`, no
 * logger), so they can be unit-tested in isolation without dragging in the DI
 * container. The stateful service (`session-metadata-service`) composes them
 * around git/lsof/pgrep calls and DB lookups, and re-exports them for callers.
 */

import type {
  SessionPortInfo,
  SessionPrStatus,
} from "@/types/session-metadata";

/** Count porcelain-dirty entries (each non-empty line is one path). */
export function parseGitStatusPorcelain(stdout: string): number {
  return stdout.split("\n").filter((l) => l.trim().length > 0).length;
}

/**
 * Parse `git rev-list --left-right --count @{u}...HEAD` output, which is
 * `behind<TAB>ahead` (left = upstream-only commits, right = HEAD-only commits).
 * Tolerates tab- or space-separated counts; defaults to zero on anything else.
 */
export function parseAheadBehind(stdout: string): {
  behind: number;
  ahead: number;
} {
  const m = stdout.trim().match(/^(\d+)\s+(\d+)$/);
  if (!m) return { behind: 0, ahead: 0 };
  return { behind: parseInt(m[1], 10) || 0, ahead: parseInt(m[2], 10) || 0 };
}

/** A subset of a cached `githubPullRequests` row used to build a PR chip. */
export type CachedPrRow = {
  prNumber: number;
  state: SessionPrStatus["state"];
  url: string;
  isDraft: boolean;
  reviewDecision: SessionPrStatus["reviewDecision"];
  ciStatus: SessionPrStatus["ciStatus"];
};

/** Map a cached `githubPullRequests` row to the client-facing PR shape. */
export function mapCachedPrToStatus(row: CachedPrRow): SessionPrStatus {
  return {
    number: row.prNumber,
    state: row.state,
    url: row.url,
    isDraft: row.isDraft,
    reviewDecision: row.reviewDecision ?? null,
    ciStatus: row.ciStatus ?? null,
  };
}

/** Pure: keep ports whose pid is in `pids`, sorted ascending by port. */
export function attributePortsToPids(
  listening: Map<number, { process?: string; pid?: number }>,
  pids: Set<number>,
): SessionPortInfo[] {
  const out: SessionPortInfo[] = [];
  for (const [port, info] of listening) {
    if (info.pid != null && pids.has(info.pid)) {
      out.push({ port, process: info.process ?? null, pid: info.pid });
    }
  }
  return out.sort((a, b) => a.port - b.port);
}
