/**
 * Claude Session Service
 *
 * Discovers resumable Claude Code sessions by scanning .jsonl files
 * from ~/.claude/projects/<encoded-path>/ (or profile-isolated equivalent).
 */

import { createReadStream } from "fs";
import { readdir, stat } from "fs/promises";
import { createInterface } from "readline";
import { join, basename } from "path";
import { homedir } from "os";
import type { ClaudeSessionSummary } from "@/types/claude-session";

export type { ClaudeSessionSummary };

export interface ListSessionsOptions {
  limit?: number;
  profileConfigDir?: string;
}

/**
 * Encode a filesystem path to the Claude projects directory name.
 * Claude replaces all non-alphanumeric characters with "-".
 */
export function encodePath(fsPath: string): string {
  return fsPath.replace(/[^a-zA-Z0-9]/g, "-");
}

function getProjectsDir(profileConfigDir?: string): string {
  const claudeDir = profileConfigDir
    ? join(profileConfigDir, ".claude")
    : join(homedir(), ".claude");
  return join(claudeDir, "projects");
}

/**
 * Parse a .jsonl session file using streaming to extract header and first user message.
 * Reads only the first lines needed, then stops — avoids loading multi-MB files into memory.
 */
function parseSessionFile(filePath: string): Promise<{
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  timestamp?: string;
  firstUserMessage?: string;
} | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let header: {
      sessionId?: string;
      cwd?: string;
      gitBranch?: string;
      version?: string;
      timestamp?: string;
    } | null = null;
    let firstUserMessage: string | undefined;

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const entry = JSON.parse(trimmed);

        // Extract header from first system line
        if (!header && entry.type === "system" && entry.cwd) {
          header = {
            sessionId: entry.sessionId,
            cwd: entry.cwd,
            gitBranch: entry.gitBranch,
            version: entry.version,
            timestamp: entry.timestamp,
          };
        }

        // Extract first real user message
        if (!firstUserMessage && entry.type === "user") {
          const msg = entry.message?.content;
          let text: string | undefined;

          if (typeof msg === "string") {
            text = msg;
          } else if (Array.isArray(msg)) {
            const textBlock = msg.find(
              (b: { type: string; text?: string }) => b.type === "text"
            );
            if (textBlock?.text) text = textBlock.text as string;
          }

          if (
            text &&
            !text.startsWith("<command-") &&
            !text.startsWith("<local-command-") &&
            !text.includes("Caveat:")
          ) {
            firstUserMessage = text.slice(0, 200);
          }
        }

        // Stop reading once we have both pieces
        if (header && firstUserMessage) {
          stream.on("error", () => {});
          rl.close();
          stream.destroy();
        }
      } catch {
        // Skip malformed lines
      }
    });

    rl.on("close", () => {
      stream.destroy();
      resolve(header ? { ...header, firstUserMessage } : null);
    });
    rl.on("error", () => {
      rl.close();
      stream.destroy();
      resolve(null);
    });
  });
}

/**
 * List resumable Claude Code sessions for a given project path.
 * Returns sessions sorted by last modification time (newest first).
 */
export async function listSessions(
  projectPath: string,
  options: ListSessionsOptions = {}
): Promise<ClaudeSessionSummary[]> {
  if (!projectPath) return [];

  const { limit = 20, profileConfigDir } = options;
  const encodedPath = encodePath(projectPath);
  const projectsDir = getProjectsDir(profileConfigDir);
  const sessionDir = join(projectsDir, encodedPath);

  let files: string[];
  try {
    const entries = await readdir(sessionDir);
    files = entries
      .filter((f: string) => f.endsWith(".jsonl"))
      .map((f: string) => join(sessionDir, f));
  } catch {
    return [];
  }

  // Stat files in parallel for mtime-based sorting
  const withMtime = await Promise.all(
    files.map(async (filePath) => {
      try {
        const s = await stat(filePath);
        return { filePath, mtime: s.mtimeMs };
      } catch {
        return { filePath, mtime: 0 };
      }
    })
  );

  // Sort newest first, take top candidates (oversample to handle unparseable files)
  withMtime.sort((a, b) => b.mtime - a.mtime);
  const CANDIDATE_MULTIPLIER = 2;
  const candidates = withMtime.slice(0, limit * CANDIDATE_MULTIPLIER);

  // Parse candidates in parallel (streaming reads are cheap)
  const parsed = await Promise.all(
    candidates.map(async ({ filePath, mtime }) => {
      const result = await parseSessionFile(filePath);
      return { filePath, mtime, parsed: result };
    })
  );

  return parsed
    .filter((r) => r.parsed?.cwd && r.parsed?.timestamp)
    .slice(0, limit)
    .map(({ filePath, mtime, parsed: p }) => {
      const sessionId = p!.sessionId ?? basename(filePath, ".jsonl");
      return {
        sessionId,
        cwd: p!.cwd!,
        gitBranch: p!.gitBranch,
        version: p!.version,
        timestamp: p!.timestamp!,
        lastModified: new Date(mtime).toISOString(),
        firstUserMessage: p!.firstUserMessage,
      };
    });
}
