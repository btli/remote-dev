/**
 * Types for Crown best-of-N (epic remote-dev-oyej.5/.6).
 *
 * Crown = same prompt → N agents → N worktree branches → collect filtered diffs
 * → LLM judge picks a winner → auto-PR the winner. Builds on the `rdv teams`
 * fan-out primitive, driven server-side via N `AgentRunService.launchAgentRun`
 * calls sharing a `crownRunId`.
 */

/** Lifecycle of a Crown run. */
export type CrownRunStatus = "running" | "judging" | "completed" | "failed";

/** A single Crown candidate (one agent's branch + diff). */
export interface CrownCandidate {
  id: string;
  crownRunId: string;
  runId: string | null;
  branch: string;
  worktreePath: string | null;
  diff: string | null;
  /** JSON-encoded { files, additions, deletions }. */
  diffStats: string | null;
}

/** Parsed result of the LLM judge. `winner` is a candidateId. */
export interface CrownJudgeResult {
  winner: string;
  reason: string;
}

/** Input to start a Crown run. */
export interface CrownInput {
  projectId: string;
  prompt: string;
  count: number;
  agentProvider?: string;
  judgeModel?: string;
  baseBranch?: string | null;
  /** Per-run timeout (ms) for candidate completion before judging. */
  timeoutMs?: number;
}

/** Diff-stat summary stored per candidate. */
export interface CrownDiffStats {
  files: number;
  additions: number;
  deletions: number;
}
