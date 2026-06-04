/**
 * Durable resume binding: the resume *intent* (flags + sanitized env) persisted
 * on the session so a recreate (terminal-server restart, pod restart) can
 * relaunch the agent even though the in-memory id map and original env are gone.
 *
 * SECURITY (Vault threat model): never persist plaintext secrets. We strip the
 * env with an allowlist-beats-denylist policy — only env vars genuinely needed
 * to LOCATE the resume session files (CLI home dirs, XDG paths) are kept; API
 * keys / tokens / passwords are dropped. A pod-restart relaunch therefore
 * resumes the *conversation* but relies on the agent's own credential store for
 * secrets.
 */

import type { ResumeBinding, ResumeResolution } from "@/types/agent-resume";

/** Substrings (case-insensitive) that mark an env var as secret and unstorable. */
const SENSITIVE_PATTERNS = [
  "TOKEN",
  "SECRET",
  "KEY",
  "PASSWORD",
  "PASSWD",
  "CREDENTIAL",
  "PRIVATE",
  "AUTH",
  "AWS_",
  "SESSION_TOKEN",
];

/**
 * Env vars we DO keep — needed to find the resume session dir on recreate.
 * Allowlist wins over the denylist (e.g. CLAUDE_CONFIG_DIR contains no secret
 * despite not matching, and is required to locate the profile-isolated history).
 */
const SAFE_ALLOWLIST = new Set([
  "HOME",
  "TERM",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "GEMINI_HOME",
  "OPENCODE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "RDV_SESSION_ID",
  "RDV_TERMINAL_PORT",
]);

/**
 * Strip sensitive env vars, keeping only the allowlisted dir-pointer vars.
 * Allowlist beats denylist; everything not explicitly safe is dropped.
 */
export function stripSensitiveEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (SAFE_ALLOWLIST.has(k)) {
      out[k] = v;
      continue;
    }
    const upper = k.toUpperCase();
    if (SENSITIVE_PATTERNS.some((p) => upper.includes(p))) continue; // drop secret
    // Drop everything not explicitly safe — allowlist beats denylist for resume.
  }
  return out;
}

/** Build a durable resume binding from a resolution + the launch env. */
export function buildResumeBinding(
  resolution: Pick<ResumeResolution, "provider" | "resumeFlags" | "argvOverride">,
  env: Record<string, string>,
): ResumeBinding {
  return {
    provider: resolution.provider,
    resumeFlags: resolution.resumeFlags,
    argvOverride: resolution.argvOverride,
    env: stripSensitiveEnv(env),
    capturedAt: new Date().toISOString(),
  };
}
