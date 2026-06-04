/**
 * Client-safe resume metadata (no server-only imports).
 *
 * The full registry (`agent-resume-registry.ts`) pulls `@/lib/exec` →
 * `node:child_process`, so it cannot be bundled into client components. This
 * module mirrors ONLY the client-relevant slice of that registry — which
 * providers support resume, and the token used to build a resume command — so
 * the resume picker (and the agent-exit screen) can stay client-side without
 * duplicating ad-hoc `Set`s inline.
 *
 * Keep the two in sync: every entry here MUST match the matching
 * `ProviderResumeSpec` in `agent-resume-registry.ts` (a test asserts parity).
 */

import type { AgentProviderType } from "@/types/session";

/** How a provider's resume command is assembled (client mirror of ResumeTemplate). */
type ClientResumeKind = "flag" | "subcommand" | "none";

interface ClientResumeInfo {
  supportsResume: boolean;
  kind: ClientResumeKind;
  /** Flag (e.g. "--resume") or subcommand (e.g. "resume"); undefined when none. */
  token?: string;
}

/**
 * Client-visible resume capability + token per provider. Mirrors
 * `AGENT_RESUME_REGISTRY[*].{supportsResume,resume}`.
 */
export const CLIENT_RESUME_INFO: Record<AgentProviderType, ClientResumeInfo> = {
  claude: { supportsResume: true, kind: "flag", token: "--resume" },
  // Codex resume is a SUBCOMMAND (`codex resume <id>`), but the new-session
  // launch path appends agentFlags directly after the command, so the same
  // [token, id] pair yields the correct `codex resume <id>` argv.
  codex: { supportsResume: true, kind: "subcommand", token: "resume" },
  gemini: { supportsResume: true, kind: "flag", token: "--resume" },
  opencode: { supportsResume: true, kind: "flag", token: "--session" },
  antigravity: { supportsResume: false, kind: "none" },
  none: { supportsResume: false, kind: "none" },
};

/** Whether the provider can resume a prior conversation (client-safe check). */
export function providerSupportsResume(provider: AgentProviderType): boolean {
  return CLIENT_RESUME_INFO[provider]?.supportsResume ?? false;
}

/**
 * Build the `agentFlags` that resume a given native session id for a provider.
 *
 * Returns `[token, id]` for both flag- and subcommand-kind providers — the
 * new-session agent plugin builds the command as `<provider.command> <flags…>`,
 * so `["--resume", id]` → `claude --resume <id>` and `["resume", id]` →
 * `codex resume <id>`. Returns `null` for providers without resume support.
 *
 * The id is sanitized by the caller (and again server-side) before it reaches a
 * shell; this helper only assembles the token pair.
 */
export function buildResumeAgentFlags(
  provider: AgentProviderType,
  nativeSessionId: string,
): string[] | null {
  const info = CLIENT_RESUME_INFO[provider];
  if (!info?.supportsResume || !info.token) return null;
  return [info.token, nativeSessionId];
}
