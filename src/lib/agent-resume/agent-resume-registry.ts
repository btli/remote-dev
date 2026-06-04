/**
 * Declarative per-provider resume registry (cmux.json-style data, no behavior).
 *
 * This is the SINGLE SOURCE OF TRUTH for how each agent provider resumes a
 * conversation. The resolver (`AgentResumeResolverImpl`) and on-disk discovery
 * (`session-id-discovery.ts`) read from here; there is no inline provider
 * `switch` in the launch paths.
 *
 * Asymmetry note: Claude pushes its native session id via the Stop hook (see
 * `crates/rdv/src/commands/hook.rs`) so capture is real-time. Codex / Gemini /
 * OpenCode have no hook system today, so they rely on **disk discovery** at
 * relaunch (newest session file under the provider's profile-isolated home dir).
 * Antigravity has no confirmed resume mechanism and is treated as no-resume
 * (graceful fresh relaunch).
 *
 * Provider flag spelling is version-dependent. `verifyResumeFlag()` probes the
 * installed CLI's `--help` at startup diagnostics to catch drift; if a token is
 * missing the registry should be adjusted (not the resolver).
 */

import type { AgentProviderType } from "@/types/session";
import type { ResumeTemplate } from "@/types/agent-resume";
import { execFileNoThrow } from "@/lib/exec";
import { createLogger } from "@/lib/logger";

const log = createLogger("AgentResumeRegistry");

/** Where a provider's native session ids live on disk, for discovery. */
export interface SessionIdSource {
  /** Env var holding the CLI home dir (profile-isolated), or null. */
  homeEnvVar: string | null;
  /** Relative-to-$HOME default path when the env var is unset. */
  defaultHomeSubpath: string;
  /** Extension(s) stripped from the newest file's name to recover the bare id. */
  fileExtensions: string[];
  /** Whether the native id is the filename stem or read from inside the file. */
  idFrom: "filename" | "header.id" | "header.sessionId";
}

export interface ProviderResumeSpec {
  provider: AgentProviderType;
  supportsResume: boolean;
  /** How we detect the CLI is present (used by verification + UI). */
  detect: { command: string; versionArgs: string[] };
  /** Where native ids live, for disk discovery. */
  sessionIdSource: SessionIdSource;
  resume: ResumeTemplate;
}

export const AGENT_RESUME_REGISTRY: Record<AgentProviderType, ProviderResumeSpec> = {
  claude: {
    provider: "claude",
    supportsResume: true,
    detect: { command: "claude", versionArgs: ["--version"] },
    sessionIdSource: {
      homeEnvVar: "CLAUDE_CONFIG_DIR",
      defaultHomeSubpath: ".claude/projects",
      fileExtensions: ["jsonl"],
      idFrom: "filename",
    },
    resume: { kind: "flag", token: "--resume" },
  },
  codex: {
    provider: "codex",
    supportsResume: true,
    detect: { command: "codex", versionArgs: ["--version"] },
    sessionIdSource: {
      homeEnvVar: "CODEX_HOME",
      defaultHomeSubpath: ".codex/sessions",
      fileExtensions: ["jsonl", "json"],
      idFrom: "filename",
    },
    // Codex resume is a SUBCOMMAND (`codex resume <id>`), not a flag.
    resume: { kind: "subcommand", token: "resume" },
  },
  gemini: {
    provider: "gemini",
    supportsResume: true,
    detect: { command: "gemini", versionArgs: ["--version"] },
    sessionIdSource: {
      homeEnvVar: "GEMINI_HOME",
      defaultHomeSubpath: ".gemini/tmp",
      fileExtensions: ["json", "jsonl"],
      idFrom: "filename",
    },
    resume: { kind: "flag", token: "--resume" },
  },
  opencode: {
    provider: "opencode",
    supportsResume: true,
    detect: { command: "opencode", versionArgs: ["--version"] },
    sessionIdSource: {
      homeEnvVar: "OPENCODE_HOME",
      defaultHomeSubpath: ".local/share/opencode",
      fileExtensions: ["json", "jsonl"],
      idFrom: "filename",
    },
    resume: { kind: "flag", token: "--session" },
  },
  antigravity: {
    provider: "antigravity",
    supportsResume: false,
    detect: { command: "agy", versionArgs: ["--version"] },
    sessionIdSource: {
      homeEnvVar: null,
      defaultHomeSubpath: "",
      fileExtensions: [],
      idFrom: "filename",
    },
    resume: { kind: "none" },
  },
  none: {
    provider: "none",
    supportsResume: false,
    detect: { command: "", versionArgs: [] },
    sessionIdSource: {
      homeEnvVar: null,
      defaultHomeSubpath: "",
      fileExtensions: [],
      idFrom: "filename",
    },
    resume: { kind: "none" },
  },
};

/** Look up a provider's resume spec, defaulting to the no-resume `none` spec. */
export function getResumeSpec(p: AgentProviderType): ProviderResumeSpec {
  return AGENT_RESUME_REGISTRY[p] ?? AGENT_RESUME_REGISTRY.none;
}

/**
 * Verify the installed CLI actually advertises the registry's resume token.
 *
 * Runs `<command> --help` and checks the help text contains the token. Used at
 * startup diagnostics (NOT on the hot path) to catch version drift, e.g. a
 * provider renaming `--resume`. Returns false (and logs a warn) when the token
 * is absent so callers can fall back to a fresh relaunch.
 */
export async function verifyResumeFlag(
  provider: AgentProviderType,
  env: Record<string, string> = {},
): Promise<boolean> {
  const spec = getResumeSpec(provider);
  if (!spec.supportsResume || !spec.resume.token) return false;

  const result = await execFileNoThrow(spec.detect.command, ["--help"], {
    timeout: 4000,
    env: { ...process.env, ...env },
  });
  const help = `${result.stdout}\n${result.stderr}`;
  const ok = help.includes(spec.resume.token);
  if (!ok) {
    log.warn("Resume token not advertised by CLI --help; resume may fall back to fresh", {
      provider,
      token: spec.resume.token,
      command: spec.detect.command,
    });
  }
  return ok;
}
