/**
 * AgentTitleService — Intelligent auto-titling for agent sessions.
 *
 * Reads the Claude Code .jsonl session file to extract the first user message,
 * derives a 3–5 word kebab-case title, and updates the session name + stores the stable
 * Claude session UUID in typeMetadata. Idempotent: runs at most once per session.
 */

import { db } from "@/db";
import { terminalSessions, agentProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import { safeJsonParse } from "@/lib/utils";
import { listSessions } from "@/services/claude-session-service";

const log = createLogger("AgentTitleService");

const MAX_TITLE_WORDS = 5;

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "to", "for", "in", "of", "with",
  "and", "or", "but", "not", "it", "its", "this", "that",
]);

export interface AutoTitleResult {
  applied: boolean;
  title?: string;
  claudeSessionId?: string;
  userId?: string;
}

/**
 * Derive a short 3–5 word kebab-case title from a user message.
 * Strips command prefixes, slash commands, stop words, and punctuation.
 */
export function deriveShortTitle(message: string): string | null {
  // Take first line only
  let text = message.split("\n")[0].trim();
  if (!text) return null;

  // Strip leading slash-command patterns like "/feature-dev:feature-dev"
  text = text.replace(/^\/[\w:_-]+\s*/, "");

  // Strip markdown formatting
  text = text.replace(/[*_`#]/g, "");

  // Strip leading articles/filler words
  text = text.replace(/^(please|can you|could you|i want to|i need to|let's|lets)\s+/i, "");

  // Strip common stop words to make titles more meaningful
  const allWords = text.split(/\s+/).filter(Boolean);
  const meaningful = allWords.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  // Fall back to original words if all were stop words
  const wordPool = meaningful.length > 0 ? meaningful : allWords;

  // Take first N words
  const words = wordPool.slice(0, MAX_TITLE_WORDS);
  if (words.length === 0) return null;

  // Lowercase, strip non-alpha chars, kebab-case
  const title = words
    .map((w) => w.toLowerCase().replace(/[^a-z]/g, ""))
    .filter(Boolean)
    .join("-");

  return title || null;
}

/**
 * Try to auto-title an agent session from its Claude Code .jsonl file.
 * Idempotent: no-ops if title is already locked or claudeSessionId is set.
 */
export async function tryApplyAutoTitle(
  sessionId: string
): Promise<AutoTitleResult> {
  // 1. Load session
  const session = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, sessionId),
    columns: {
      id: true,
      name: true,
      userId: true,
      terminalType: true,
      typeMetadata: true,
      projectPath: true,
      profileId: true,
      createdAt: true,
    },
  });

  if (!session) {
    log.debug("Session not found", { sessionId });
    return { applied: false };
  }

  // 2. Guard: only agent/loop sessions (both are Claude-backed)
  if (session.terminalType !== "agent" && session.terminalType !== "loop") {
    return { applied: false };
  }

  // 3. Guard: check typeMetadata for lock or existing claudeSessionId
  const meta = safeJsonParse<Record<string, unknown>>(session.typeMetadata, {});

  if (meta.titleLocked === true || meta.claudeSessionId) {
    return { applied: false };
  }

  // 4. Resolve the .jsonl path
  if (!session.projectPath) {
    log.debug("No project path for session", { sessionId });
    return { applied: false };
  }

  let profileConfigDir: string | undefined;
  if (session.profileId) {
    const profile = await db.query.agentProfiles.findFirst({
      where: eq(agentProfiles.id, session.profileId),
      columns: { configDir: true },
    });
    profileConfigDir = profile?.configDir;
  }

  // 5. Find the .jsonl file that was created closest to (and after) this session's start
  const claudeSessions = await listSessions(session.projectPath, {
    limit: 3,
    profileConfigDir,
  });

  if (claudeSessions.length === 0) {
    log.debug("No Claude sessions found", { sessionId, projectPath: session.projectPath });
    return { applied: false };
  }

  // Filter to .jsonl files created after this rdv session, pick the closest match
  const sessionCreatedMs = session.createdAt.getTime();
  const candidates = claudeSessions.filter((cs) => {
    const csTime = new Date(cs.timestamp).getTime();
    return csTime >= sessionCreatedMs;
  });
  // Fall back to the newest file if no candidates match (clock skew, etc.)
  const claudeSession = candidates.length > 0
    ? candidates[candidates.length - 1] // oldest match (closest to session creation)
    : claudeSessions[0];

  if (!claudeSession.firstUserMessage) {
    log.debug("No first user message in Claude session", { sessionId, claudeSessionId: claudeSession.sessionId });
    return { applied: false };
  }

  // 6. Derive title
  const title = deriveShortTitle(claudeSession.firstUserMessage);
  if (!title) {
    log.debug("Could not derive title from message", { sessionId, message: claudeSession.firstUserMessage.slice(0, 50) });
    return { applied: false };
  }

  const claudeSessionId = claudeSession.sessionId;

  // 7. Atomic update: set name + claudeSessionId in typeMetadata
  let wrote = false;
  await db.transaction(async (tx) => {
    // Re-read to avoid race conditions
    const current = await tx.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, sessionId),
      columns: { typeMetadata: true },
    });

    const currentMeta = safeJsonParse<Record<string, unknown>>(current?.typeMetadata, {});

    // Double-check the guard inside the transaction
    if (currentMeta.titleLocked === true || currentMeta.claudeSessionId) {
      return;
    }

    currentMeta.claudeSessionId = claudeSessionId;

    await tx
      .update(terminalSessions)
      .set({
        name: title,
        typeMetadata: JSON.stringify(currentMeta),
        updatedAt: new Date(),
      })
      .where(eq(terminalSessions.id, sessionId));

    wrote = true;
  });

  if (!wrote) {
    return { applied: false };
  }

  log.info("Auto-titled agent session", { sessionId, title, claudeSessionId });

  return { applied: true, title, claudeSessionId, userId: session.userId };
}
