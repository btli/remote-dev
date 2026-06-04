/**
 * [n6uc.4] Needs-attention derivation for a session.
 *
 * Consumes the y5ch notification `severity` model directly: the most recent
 * UNREAD notification for the session decides the attention level, with a
 * fallback to the live `agentActivityStatus` when no notification has been
 * recorded yet (e.g. the agent flipped to "waiting" before a notification row
 * landed, or notifications were suppressed by focus/quiet-hours gating).
 *
 * Kept in its own module (rather than inline in `session-metadata-service`) so
 * the severity→attention mapping lives in exactly one place; if y5ch's enum ever
 * changes, only this file needs updating.
 */

import { db } from "@/db";
import { notificationEvents } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { SessionAttention } from "@/types/session-metadata";

/**
 * Highest unmet attention level for a session.
 *
 * Primary source: the most recent UNREAD notification's `severity` (y5ch.1).
 *   - "error"      → "error"
 *   - "actionable" → "actionable"
 *   - "passive"    → ignored (informational; not attention-worthy)
 *
 * Fallback (only when there is no unread actionable/error notification): the
 * live `agentActivityStatus` — "error" → error, "waiting" → actionable.
 */
export async function deriveAttention(
  userId: string,
  sessionId: string,
  agentActivityStatus: string | null,
): Promise<SessionAttention> {
  const latest = await db.query.notificationEvents.findFirst({
    where: and(
      eq(notificationEvents.userId, userId),
      eq(notificationEvents.sessionId, sessionId),
      isNull(notificationEvents.readAt),
    ),
    orderBy: [desc(notificationEvents.createdAt)],
    columns: { severity: true },
  });

  if (latest?.severity === "error") return "error";
  if (latest?.severity === "actionable") return "actionable";

  // No unread actionable/error notification — fall back to live agent status.
  if (agentActivityStatus === "error") return "error";
  if (agentActivityStatus === "waiting") return "actionable";
  return null;
}
