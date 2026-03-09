import { db } from "@/db";
import { notificationEvents } from "@/db/schema";
import { eq, and, desc, isNull, inArray, sql } from "drizzle-orm";
import type { NotificationEvent, CreateNotificationInput } from "@/types/notification";

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
  evictStaleEntries();

  const [row] = await db.insert(notificationEvents).values({
    userId: input.userId,
    sessionId: input.sessionId ?? null,
    sessionName: input.sessionName ?? null,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
  }).returning();

  return mapRow(row);
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

export async function getUnreadCount(userId: string): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(notificationEvents)
    .where(and(
      eq(notificationEvents.userId, userId),
      isNull(notificationEvents.readAt)
    ));
  return result[0]?.count ?? 0;
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
    readAt: row.readAt ? new Date(row.readAt) : null,
    createdAt: new Date(row.createdAt),
  };
}
