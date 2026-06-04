/**
 * [y5ch.6] User notification preferences service.
 *
 * Reads/writes the `notificationPreferences` row for a user and resolves it into
 * the `ResolvedNotificationPrefs` shape consumed by the policy hook
 * (`@/lib/notification-policy`). A missing row yields sane defaults:
 * actionable-and-up pushes, no per-type opt-outs, no muted sessions, no quiet hours.
 */
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ResolvedNotificationPrefs } from "@/lib/notification-policy";
import type { NotificationSeverity } from "@/types/notification";
import { createLogger } from "@/lib/logger";

const log = createLogger("NotificationPreferences");

const DEFAULTS: ResolvedNotificationPrefs = {
  pushByType: {},
  mutedSessionIds: new Set(),
  quietHours: null,
  minPushSeverity: "actionable",
};

/** Resolve the effective prefs for a user (the shape the policy hook consumes). */
export async function resolvePrefs(userId: string): Promise<ResolvedNotificationPrefs> {
  const row = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.userId, userId),
  });
  if (!row) return DEFAULTS;
  return {
    pushByType: row.pushByType ?? {},
    mutedSessionIds: new Set(row.mutedSessionIds ?? []),
    quietHours:
      row.quietHoursStart != null && row.quietHoursEnd != null
        ? { startHour: row.quietHoursStart, endHour: row.quietHoursEnd }
        : null,
    minPushSeverity: row.minPushSeverity ?? "actionable",
  };
}

export interface UpdatePrefsInput {
  pushByType?: Record<string, boolean>;
  mutedSessionIds?: string[];
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  minPushSeverity?: NotificationSeverity;
}

/** Raw row for the prefs API (so the client can render the current settings). */
export async function getRawPrefs(userId: string) {
  return (
    (await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    })) ?? null
  );
}

export async function upsertPrefs(userId: string, input: UpdatePrefsInput): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({
      userId,
      pushByType: input.pushByType ?? {},
      mutedSessionIds: input.mutedSessionIds ?? [],
      quietHoursStart: input.quietHoursStart ?? null,
      quietHoursEnd: input.quietHoursEnd ?? null,
      minPushSeverity: input.minPushSeverity ?? "actionable",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        ...(input.pushByType !== undefined && { pushByType: input.pushByType }),
        ...(input.mutedSessionIds !== undefined && { mutedSessionIds: input.mutedSessionIds }),
        ...(input.quietHoursStart !== undefined && { quietHoursStart: input.quietHoursStart }),
        ...(input.quietHoursEnd !== undefined && { quietHoursEnd: input.quietHoursEnd }),
        ...(input.minPushSeverity !== undefined && { minPushSeverity: input.minPushSeverity }),
        updatedAt: new Date(),
      },
    });
  log.info("Notification prefs updated", { userId });
}

/**
 * Convenience used by the row long-press ActionSheet: toggle one session's mute
 * state, returning the new state (true = now muted).
 */
export async function toggleSessionMute(userId: string, sessionId: string): Promise<boolean> {
  const raw = await getRawPrefs(userId);
  const current = new Set(raw?.mutedSessionIds ?? []);
  const nowMuted = !current.has(sessionId);
  if (nowMuted) current.add(sessionId);
  else current.delete(sessionId);
  await upsertPrefs(userId, { mutedSessionIds: [...current] });
  return nowMuted;
}
