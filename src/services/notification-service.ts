import { db } from "@/db";
import { notificationEvents } from "@/db/schema";
import { eq, and, desc, isNull, inArray, count, gt, sql } from "drizzle-orm";
import type {
  NotificationEvent,
  CreateNotificationInput,
  NotificationSeverity,
} from "@/types/notification";
import { notificationSeverity, notificationGroup } from "@/types/notification";
import { applyNotificationPolicy } from "@/lib/notification-policy";
import { resolvePrefs } from "@/services/notification-preferences-service";
import type { PushNotificationGateway } from "@/application/ports/PushNotificationGateway";
import type { PushTokenRepository } from "@/application/ports/PushTokenRepository";
import { resolveTerminalServerUrl } from "@/lib/terminal-server-url";
import { createLogger } from "@/lib/logger";

const log = createLogger("NotificationService");

// Push notification gateway and token repository — set via DI from container.ts
let pushGateway: PushNotificationGateway | null = null;
let pushTokenRepo: PushTokenRepository | null = null;

/** Set the push notification gateway (called from container.ts). */
export function setPushGateway(gateway: PushNotificationGateway): void {
  pushGateway = gateway;
}

/** Set the push token repository (called from container.ts). */
export function setPushTokenRepository(repo: PushTokenRepository): void {
  pushTokenRepo = repo;
}

/**
 * [y5ch.5] Window after which an open notification is considered "closed" and a
 * new event starts a fresh row instead of coalescing. The clear boundary: a
 * read (markRead) OR this window elapsing closes the group.
 */
const COALESCE_WINDOW_MS = 60_000;

/**
 * [y5ch] Create a notification, applying the policy + prefs gate, then coalescing
 * by `(userId, sessionId, group)` into a mutable open row. Returns the stored
 * row, or `null` when the policy suppresses storage entirely (e.g. session muted).
 *
 * The FCM push is dispatched only when `decision.push` is true (severity-gated,
 * per-type/per-session opt-out, focus-aware, quiet-hours — see notification-policy).
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationEvent | null> {
  const severity = input.severity ?? notificationSeverity(input.type);
  const prefs = await resolvePrefs(input.userId);
  const decision = applyNotificationPolicy(input, prefs, {
    now: new Date(),
    focused: input.focused ?? false,
  });

  if (!decision.store) {
    log.debug("Notification suppressed", { type: input.type, reason: decision.reason });
    return null;
  }

  // [y5ch.5] Coalesce repeated events in the same group into one open row.
  const notification = await upsertCoalesced(input, severity);

  // [y5ch.10] FCM push fires only when the policy allows it.
  if (decision.push) {
    if (pushGateway && pushTokenRepo) {
      dispatchPush(notification).catch((err) =>
        log.warn("Push notification dispatch failed", { error: String(err) }),
      );
    }
  } else {
    log.debug("Push gated off", { type: input.type, reason: decision.reason });
  }

  return notification;
}

/**
 * [y5ch.5] Collapse repeated notifications in the same
 * `(userId, sessionId, coalesceKey)` group into one OPEN (unread) row by bumping
 * `count` and refreshing `title`/`body`/`meta`/`severity`/`updatedAt`, instead of
 * inserting a new row or dropping it (the old 5s debounce behavior).
 *
 * Clear boundary: the merge query requires `isNull(readAt)` (so reading a row
 * closes the group) AND `updatedAt > cutoff` (so an idle group older than
 * COALESCE_WINDOW_MS starts fresh). A `null` sessionId never coalesces.
 */
async function upsertCoalesced(
  input: CreateNotificationInput,
  severity: NotificationSeverity,
): Promise<NotificationEvent> {
  const coalesceKey = notificationGroup(input.type);
  const cutoff = new Date(Date.now() - COALESCE_WINDOW_MS);

  const existing = input.sessionId
    ? await db.query.notificationEvents.findFirst({
        where: and(
          eq(notificationEvents.userId, input.userId),
          eq(notificationEvents.sessionId, input.sessionId),
          eq(notificationEvents.coalesceKey, coalesceKey),
          isNull(notificationEvents.readAt),
          gt(notificationEvents.updatedAt, cutoff),
        ),
      })
    : null;

  if (existing) {
    const [updated] = await db
      .update(notificationEvents)
      .set({
        title: input.title,
        body: input.body ?? null,
        type: input.type,
        severity,
        meta: input.meta ?? null,
        // [y5ch.5] Atomic increment in SQL — a read-modify-write (count+1 in JS)
        // would lose increments when concurrent events coalesce into the same
        // row, undercounting the ×N badge. `count + 1` is computed by the DB.
        count: sql`${notificationEvents.count} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(notificationEvents.id, existing.id))
      .returning();
    return mapRow(updated);
  }

  const [row] = await db
    .insert(notificationEvents)
    .values({
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      sessionName: input.sessionName ?? null,
      type: input.type,
      severity,
      title: input.title,
      body: input.body ?? null,
      coalesceKey,
      count: 1,
      meta: input.meta ?? null,
    })
    .returning();
  return mapRow(row);
}

/** Dispatch push notification to all user devices (fire-and-forget). */
async function dispatchPush(notification: NotificationEvent): Promise<void> {
  if (!pushGateway || !pushTokenRepo) return;

  const tokens = await pushTokenRepo.findByUser(notification.userId);
  if (tokens.length === 0) return;

  const result = await pushGateway.sendToTokens(
    tokens.map((t) => t.fcmToken),
    {
      title: notification.title,
      body: notification.body,
      data: {
        notificationId: notification.id,
        type: notification.type,
        // [y5ch.8] severity + count let the client route/badge without a refetch.
        severity: notification.severity,
        count: String(notification.count),
        ...(notification.sessionId && { sessionId: notification.sessionId }),
        ...(notification.sessionName && { sessionName: notification.sessionName }),
        ...(notification.meta?.deepLinkSessionId && {
          deepLinkSessionId: notification.meta.deepLinkSessionId,
        }),
      },
    }
  );

  // Clean up stale tokens
  if (result.staleTokens.length > 0) {
    await pushTokenRepo.deleteByTokens(result.staleTokens);
  }
}

export async function listNotifications(
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {}
): Promise<NotificationEvent[]> {
  const { limit = 50, unreadOnly = false } = options;
  const conditions = [eq(notificationEvents.userId, userId)];
  if (unreadOnly) conditions.push(isNull(notificationEvents.readAt));

  const rows = await db.query.notificationEvents.findMany({
    where: and(...conditions),
    orderBy: [desc(notificationEvents.createdAt)],
    limit,
  });
  return rows.map(mapRow);
}

export async function markRead(userId: string, ids: string[]): Promise<void> {
  await db.update(notificationEvents)
    .set({ readAt: new Date() })
    .where(and(
      eq(notificationEvents.userId, userId),
      inArray(notificationEvents.id, ids)
    ));
}

export async function markAllRead(userId: string): Promise<void> {
  await db.update(notificationEvents)
    .set({ readAt: new Date() })
    .where(and(
      eq(notificationEvents.userId, userId),
      isNull(notificationEvents.readAt)
    ));
}

export async function deleteNotifications(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .delete(notificationEvents)
    .where(and(eq(notificationEvents.userId, userId), inArray(notificationEvents.id, ids)));
}

export async function deleteAllNotifications(userId: string): Promise<void> {
  await db
    .delete(notificationEvents)
    .where(eq(notificationEvents.userId, userId));
}

export async function getUnreadCount(userId: string): Promise<number> {
  const [row] = await db.select({ count: count() })
    .from(notificationEvents)
    .where(and(
      eq(notificationEvents.userId, userId),
      isNull(notificationEvents.readAt)
    ));
  return row?.count ?? 0;
}

/**
 * Broadcast a notification-dismissed event to all WebSocket clients
 * via the terminal server's internal endpoint.
 * Uses same server discovery as rdv CLI: RDV_TERMINAL_SOCKET > RDV_TERMINAL_PORT > TERMINAL_PORT > 6002.
 * Fire-and-forget — failures are logged but never thrown.
 */
export async function broadcastDismissed(opts: { userId: string; ids?: string[]; all?: boolean }): Promise<void> {
  try {
    const baseUrl = resolveTerminalServerUrl();
    const resp = await fetch(`${baseUrl}/internal/notification-dismissed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!resp.ok) {
      log.warn("Failed to broadcast notification dismissed", { status: resp.status });
    }
  } catch (err) {
    log.warn("Failed to broadcast notification dismissed", { error: String(err) });
  }
}

function mapRow(row: typeof notificationEvents.$inferSelect): NotificationEvent {
  const type = row.type as NotificationEvent["type"];
  return {
    id: row.id,
    userId: row.userId,
    sessionId: row.sessionId,
    sessionName: row.sessionName,
    type,
    // [y5ch.1] default severity from the classifier when the column is null
    // (pre-migration rows / inserts that predate the severity column).
    severity: (row.severity as NotificationSeverity | null) ?? notificationSeverity(type),
    title: row.title,
    body: row.body,
    count: row.count ?? 1,
    meta: row.meta ?? null,
    readAt: row.readAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? row.createdAt,
  };
}
