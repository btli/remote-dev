/**
 * Types for the agent automation & orchestration platform (epic remote-dev-oyej).
 *
 * An agent RUN is a REAL non-interactive agent launch: it creates a fresh
 * `terminalType:"agent"` session (autoLaunchAgent), optionally in a worktree,
 * and delivers a prompt to the agent. This is DISTINCT from the keystroke-only
 * `sessionSchedules`/`scheduleCommands` which send keystrokes to an EXISTING
 * session. See `src/services/agent-run-service.ts`.
 */

/** Lifecycle of a single agent run. */
export type AgentRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "superseded";

/** Where an agent run originated. Exactly one provenance column is set. */
export type AgentRunSource = "schedule" | "trigger" | "manual" | "crown";

/** GitHub event kinds a trigger config can react to. */
export type TriggerKind = "pr_labeled" | "issue_opened" | "ci_failed";

/** Input to create a scheduled agent run (agentSchedules). */
export interface AgentScheduleInput {
  projectId: string;
  name: string;
  agentProvider?: string;
  agentFlags?: string[];
  prompt: string;
  worktreeType?: string | null;
  baseBranch?: string | null;
  /** "recurring" (cronExpression) or "one-time" (scheduledAt). */
  scheduleType?: "recurring" | "one-time";
  cronExpression?: string | null;
  scheduledAt?: string | number | Date | null;
  timezone?: string;
  enabled?: boolean;
  maxRetries?: number;
}

/** Patch shape for updating an agent schedule. */
export type AgentScheduleUpdate = Partial<
  Omit<AgentScheduleInput, "projectId">
>;

/** Input to create/update a GitHub trigger config (triggerConfigs). */
export interface TriggerConfigInput {
  projectId: string;
  githubRepoId?: string | null;
  name: string;
  kind: TriggerKind;
  /** JSON-serializable filter (e.g. { label: "agent:fix" }). */
  filter?: Record<string, unknown>;
  agentProvider?: string;
  agentFlags?: string[];
  promptTemplate: string;
  worktreeType?: string | null;
  enabled?: boolean;
}

export type TriggerConfigUpdate = Partial<
  Omit<TriggerConfigInput, "projectId">
>;
