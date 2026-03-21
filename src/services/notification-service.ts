import { db } from "@/db";
import { notificationEvents } from "@/db/schema";
import { eq, and, desc, isNull, inArray, count } from "drizzle-orm";
import type { NotificationEvent, CreateNotificationInput } from "@/types/notification";
import type { PushNotificationGateway } from "@/application/ports/PushNotificationGateway";
import type { PushTokenRepository } from "@/application/ports/PushTokenRepository";
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

// Debounce: prevent duplicate notifications per (userId, sessionId, type) within 5s window
const recentNotifications = new Map<string, number>();
const DEBOUNCE_MS = 5000;
const MAX_DEBOUNCE_ENTRIES = 1000;

function debounceKey(userId: string, sessionId: string | undefined, type: string): string {
  return `${userId}:${sessionId ?? "none"}:${type}`;
}

/** Evict stale entries when the debounce map grows too large */
function evictStaleEntries(): void {
  if (recentNotifications.size <= MAX_DEBOUNCE_ENTRIES) return;
  const now = Date.now();
  for (const [key, timestamp] of recentNotifications) {
    if (now - timestamp > DEBOUNCE_MS) recentNotifications.delete(key);
  }
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationEvent | null> {
  const key = debounceKey(input.userId, input.sessionId, input.type);
  const now = Date.now();
  const last = recentNotifications.get(key);
  if (last && now - last < DEBOUNCE_MS) return null; // debounced

  recentNotifications.set(key, now);
  if (recentNotifications.size > MAX_DEBOUNCE_ENTRIES) evictStaleEntries();

  const [row] = await db.insert(notificationEvents).values({
    userId: input.userId,
    sessionId: input.sessionId ?? null,
    sessionName: input.sessionName ?? null,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
  }).returning();

  const notification = mapRow(row);

  // Fire-and-forget push notification dispatch
  if (pushGateway && pushTokenRepo) {
    dispatchPush(notification).catch((err) =>
      log.warn("Push notification dispatch failed", { error: String(err) })
    );
  }

  return notification;
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
        ...(notification.sessionId && { sessionId: notification.sessionId }),
        ...(notification.sessionName && { sessionName: notification.sessionName }),
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
export async function broadcastDismissed(opts: { ids?: string[]; all?: boolean }): Promise<void> {
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

function resolveTerminalServerUrl(): string {
  const socketPath = process.env.RDV_TERMINAL_SOCKET;
  if (socketPath) {
    return `http://unix:${socketPath}:`;
  }
  const port = process.env.RDV_TERMINAL_PORT ?? process.env.TERMINAL_PORT ?? "6002";
  return `http://127.0.0.1:${port}`;
}

function mapRow(row: typeof notificationEvents.$inferSelect): NotificationEvent {
  return {
    id: row.id,
    userId: row.userId,
    sessionId: row.sessionId,
    sessionName: row.sessionName,
    type: row.type as NotificationEvent["type"],
    title: row.title,
    body: row.body,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}
