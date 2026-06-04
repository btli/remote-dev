/**
 * Per-session live observability metadata surfaced in the tree/list.
 *
 * [n6uc] Aggregates git branch + dirty state, the linked PR (from the
 * `githubPullRequests` cache), the session's own listening ports (PID-tree
 * attributed), and a derived "needs attention" level (from the y5ch notification
 * `severity` model). Shared between the server (`session-metadata-service`,
 * `/api/sessions/:id/metadata`) and the client (`useSessionMetadata`,
 * `SessionMetadataBar`, jump-to-attention).
 */

import type { CIStatusState, PRState } from "@/types/github-stats";

/** Branch + ahead/behind + dirty-count for a worktree. */
export interface SessionGitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  /** Count of porcelain-dirty entries (staged + unstaged + untracked). */
  dirtyCount: number;
}

/** The linked pull request for a session's worktree branch. */
export interface SessionPrStatus {
  number: number;
  /** GitHub `state`: "open" | "closed" | "merged". */
  state: PRState;
  url: string;
  isDraft: boolean;
  reviewDecision:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "REVIEW_REQUIRED"
    | null;
  /** CI rollup: "passing" | "failing" | "pending" | "unknown". */
  ciStatus: CIStatusState | null;
}

/** A single listening port attributed to a session's process subtree. */
export interface SessionPortInfo {
  port: number;
  process: string | null;
  pid: number | null;
}

/**
 * The attention level for a session, surfaced as a dot/ring in the tree.
 * Mirrors the y5ch notification severity ordering (error > actionable).
 */
export type SessionAttention = "error" | "actionable" | null;

/** The full aggregated metadata payload for one session. */
export interface SessionMetadata {
  sessionId: string;
  git: SessionGitStatus | null;
  pr: SessionPrStatus | null;
  ports: SessionPortInfo[];
  /** ISO timestamp of last agent activity (from the session row). */
  lastActivityAt: string | null;
  /** Highest unmet severity for this session: "error" | "actionable" | null. */
  attention: SessionAttention;
}
