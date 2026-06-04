/**
 * Shared types for agent session durability & resume (Vault).
 *
 * Native agent session ids (Claude/Codex/Gemini/OpenCode) are captured into
 * `terminalSessions.typeMetadata.agentSessionId` (a per-provider map) and a
 * durable resume binding is persisted under `typeMetadata.resumeBinding` so a
 * conversation can be resumed across process death, terminal-server restart,
 * and host/pod restart.
 *
 * @see ../lib/agent-resume/agent-resume-registry.ts (declarative per-provider data)
 * @see ../infrastructure/agent-resume/AgentResumeResolverImpl.ts (resolver impl)
 */

import type { AgentProviderType } from "./session";

/** Per-provider native session ids stored in terminalSessions.typeMetadata.agentSessionId. */
export type AgentSessionIdMap = Partial<Record<AgentProviderType, string>>;

/**
 * Provider-agnostic resumable-session summary surfaced by the multi-provider
 * resume picker (`/api/agent/sessions`).
 *
 * `sessionId` + `lastModified` are always present (every discoverable provider
 * yields at least these). `firstUserMessage` / `gitBranch` are best-effort
 * previews — Claude populates them from its `.jsonl` headers; the disk-discovery
 * providers (codex/gemini/opencode) leave them undefined and the UI degrades to
 * showing just the id + timestamp.
 */
export interface ResumableSessionSummary {
  sessionId: string;
  lastModified: string; // ISO
  firstUserMessage?: string;
  gitBranch?: string;
}

/** How a provider's resume command is assembled. */
export interface ResumeTemplate {
  /**
   * "flag" → append `flag id` to argv (e.g. `claude --resume <id>`);
   * "subcommand" → `command sub id` (e.g. `codex resume <id>`);
   * "none" → provider does not support resume; relaunch fresh.
   */
  kind: "flag" | "subcommand" | "none";
  /** The flag (e.g. "--resume") or subcommand (e.g. "resume"). Unused when kind="none". */
  token?: string;
}

/** Resolved launch instruction for a resumed agent. */
export interface ResumeResolution {
  provider: AgentProviderType;
  nativeSessionId: string;
  /** Flags to pass to buildAgentCommand (flag-kind) — e.g. ["--resume", "<id>"]. */
  resumeFlags: string[];
  /** Full argv override (subcommand-kind, e.g. ["codex","resume","<id>"]) or null. */
  argvOverride: string[] | null;
}

/** Durable resume intent persisted on the session (Task hgwo.3). */
export interface ResumeBinding {
  provider: AgentProviderType;
  resumeFlags: string[];
  argvOverride: string[] | null;
  /** Sanitized env (secrets stripped) to re-inject if tmux was recreated. */
  env: Record<string, string>;
  capturedAt: string; // ISO
}
