import { db } from "@/db";
import {
  agentStatusDeliveries,
  notificationDeliveries,
  notificationEvents,
  terminalSessions,
} from "@/db/schema";
import { eq, and, desc, isNull, inArray, count, gt, sql, type SQL } from "drizzle-orm";
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
import { createHash } from "node:crypto";
import { withBusyRetry } from "@/db/busy-retry";
import { ltDate } from "@/db/sql-helpers";
import { isPostgres } from "@/db/is-postgres";

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
export const LIFECYCLE_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

// SQLite serializes writers, and a process-local keyed queue prevents a burst
// of hook transactions from colliding before busy-retry is needed. PostgreSQL
// additionally takes a transaction-scoped advisory lock for cross-process
// serialization of the empty-group SELECT→INSERT boundary.
const localCoalesceTails = new Map<string, Promise<void>>();

async function withLocalCoalesceLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = localCoalesceTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  localCoalesceTails.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (localCoalesceTails.get(key) === tail) localCoalesceTails.delete(key);
  }
}

function coalescingLockKey(input: CreateNotificationInput): string {
  // JSON gives an unambiguous tuple key without embedding NUL, which
  // PostgreSQL rejects in text parameters used by hashtextextended().
  return JSON.stringify([
    input.userId,
    input.sessionId ?? null,
    notificationGroup(input.type),
  ]);
}

function coalescingLockKeyForGroup(input: CreateNotificationInput, group: string): string {
  return JSON.stringify([input.userId, input.sessionId ?? null, group]);
}

async function withLocalCoalesceLocks<T>(
  keys: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const ordered = [...new Set(keys)].sort();
  const acquire = (index: number): Promise<T> => index >= ordered.length
    ? fn()
    : withLocalCoalesceLock(ordered[index]!, () => acquire(index + 1));
  return acquire(0);
}

async function lockPostgresCoalescingGroup(
  database: typeof db,
  input: CreateNotificationInput,
): Promise<void> {
  if (!isPostgres() || !input.sessionId) return;
  const postgresTransaction = database as unknown as {
    execute(query: SQL): Promise<unknown>;
  };
  await postgresTransaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${coalescingLockKey(input)}, 0))`,
  );
}

async function lockPostgresCoalescingGroups(
  database: typeof db,
  input: CreateNotificationInput,
  groups: string[],
): Promise<void> {
  if (!isPostgres() || !input.sessionId) return;
  const postgresTransaction = database as unknown as {
    execute(query: SQL): Promise<unknown>;
  };
  const keys = [...new Set(groups.map((group) => coalescingLockKeyForGroup(input, group)))].sort();
  for (const key of keys) {
    await postgresTransaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }
}

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

  // Authoritative lifecycle callbacks carry a stable delivery identity. Record
  // it transactionally in a receipt table, then use the ordinary coalescing
  // path. Exact retries do nothing; distinct lifecycle events still collapse
  // into the user's one open notification row.
  const notification = await withLocalCoalesceLock(
    coalescingLockKey(input),
    () => input.idempotencyKey
      ? insertIdempotentCoalesced(input, severity)
      : upsertSerialized(input, severity),
  );
  if (!notification) return null;

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

export interface AgentStatusNotificationResult {
  current: boolean;
  notification: NotificationEvent | null;
}

interface AgentStatusNotificationHooks {
  /** Test seam used to prove a newer status cannot pass the held row lock. */
  afterStatusLock?: () => Promise<void>;
}

/**
 * Materialize a status-derived notification only while its exact receipt owns
 * the session state. The guarded no-op UPDATE takes the same session-row write
 * lock used by newer status deliveries, closing the validation→insert window
 * on both SQLite and PostgreSQL.
 */
export async function createNotificationForAgentStatus(
  receiptId: string,
  rawInput: CreateNotificationInput,
  hooks: AgentStatusNotificationHooks = {},
): Promise<AgentStatusNotificationResult> {
  const input = { ...rawInput, idempotencyKey: receiptId };
  const severity = input.severity ?? notificationSeverity(input.type);
  const prefs = await resolvePrefs(input.userId);
  const decision = applyNotificationPolicy(input, prefs, {
    now: new Date(),
    focused: input.focused ?? false,
  });
  if (!decision.store) return { current: true, notification: null };

  const result = await withLocalCoalesceLock(coalescingLockKey(input), () =>
    db.transaction(async (tx) => {
      const transaction = tx as unknown as typeof db;
      const receipt = await transaction.query.agentStatusDeliveries.findFirst({
        where: eq(agentStatusDeliveries.id, receiptId),
      });
      if (!receipt?.applied) return { current: false, notification: null };

      const [locked] = await transaction
        .update(terminalSessions)
        .set({
          // A self-assignment is intentional: it obtains a write/row lock
          // without changing user-visible state or timestamps.
          agentActivityOrder: sql`${terminalSessions.agentActivityOrder}`,
        })
        .where(and(
          eq(terminalSessions.id, receipt.sessionId),
          eq(terminalSessions.userId, receipt.userId),
          sql`COALESCE(${terminalSessions.agentRestartCount}, 0) = ${receipt.generation}`,
          eq(terminalSessions.agentActivityStatus, receipt.status),
          eq(terminalSessions.agentActivityOrder, receipt.arrivalOrder),
        ))
        .returning({ id: terminalSessions.id });
      if (!locked) return { current: false, notification: null };
      await hooks.afterStatusLock?.();

      await lockPostgresCoalescingGroup(transaction, input);
      const [delivery] = await transaction
        .insert(notificationDeliveries)
        .values({
          id: idempotentDeliveryId(input),
          userId: input.userId,
        })
        .onConflictDoNothing({ target: notificationDeliveries.id })
        .returning({ id: notificationDeliveries.id });
      if (!delivery) return { current: true, notification: null };

      const notification = await upsertCoalesced(input, severity, transaction);
      await transaction
        .update(notificationDeliveries)
        .set({ notificationId: notification.id })
        .where(eq(notificationDeliveries.id, delivery.id));
      return { current: true, notification };
    }),
  );

  if (result.notification && decision.push && pushGateway && pushTokenRepo) {
    dispatchPush(result.notification).catch((err) =>
      log.warn("Push notification dispatch failed", { error: String(err) }),
    );
  }
  return result;
}

function idempotentDeliveryId(input: CreateNotificationInput): string {
  const digest = createHash("sha256")
    .update(input.userId)
    .update("\0")
    .update(input.idempotencyKey ?? "")
    .digest("hex");
  return `idem_${digest}`;
}

async function insertIdempotentCoalesced(
  input: CreateNotificationInput,
  severity: NotificationSeverity,
): Promise<NotificationEvent | null> {
  return db.transaction(async (tx) => {
    // The generated barrel gives both dialects the SQLite-compatible surface;
    // transaction handles expose the same query/insert/update methods.
    const transaction = tx as unknown as typeof db;
    await lockPostgresCoalescingGroup(transaction, input);
    const [receipt] = await transaction
      .insert(notificationDeliveries)
      .values({
        id: idempotentDeliveryId(input),
        userId: input.userId,
      })
      .onConflictDoNothing({ target: notificationDeliveries.id })
      .returning({ id: notificationDeliveries.id });
    if (!receipt) return null;
    // A failure below rolls the receipt back with the notification mutation,
    // so a later transport retry can safely try the whole delivery again.
    const notification = await upsertCoalesced(input, severity, transaction);
    await transaction
      .update(notificationDeliveries)
      .set({ notificationId: notification.id })
      .where(eq(notificationDeliveries.id, receipt.id));
    return notification;
  });
}

async function upsertSerialized(
  input: CreateNotificationInput,
  severity: NotificationSeverity,
): Promise<NotificationEvent> {
  return db.transaction(async (tx) => {
    const transaction = tx as unknown as typeof db;
    await lockPostgresCoalescingGroup(transaction, input);
    return upsertCoalesced(input, severity, transaction);
  });
}

/**
 * Replace the visible row owned by a stable delivery without incrementing its
 * count or sending a second push. Used when a late exact pane callback enriches
 * an earlier heuristic "process gone" notification for the same generation.
 * If the callback wins the race before the heuristic inserts its receipt, this
 * operation atomically claims that identity and creates the exact notification
 * instead; the later heuristic insert then becomes an idempotent no-op.
 */
export async function replaceIdempotentNotification(
  input: CreateNotificationInput & { idempotencyKey: string },
): Promise<NotificationEvent | null> {
  const severity = input.severity ?? notificationSeverity(input.type);
  const destinationGroup = notificationGroup(input.type);
  const prefs = await resolvePrefs(input.userId);
  const decision = applyNotificationPolicy(input, prefs, {
    now: new Date(),
    focused: input.focused ?? false,
  });
  // agent_stuck used the lifecycle group before lifecycle delivery hardening.
  // Lock both historical and current groups in a deterministic order so a
  // rolling-upgrade enrichment cannot race either coalescing stream.
  const possibleGroups = [destinationGroup, "agent_lifecycle", "agent_failure"];
  const outcome: { notification: NotificationEvent | null; created: boolean } =
    await withLocalCoalesceLocks(
    possibleGroups.map((group) => coalescingLockKeyForGroup(input, group)),
    () =>
      db.transaction(async (tx) => {
        const transaction = tx as unknown as typeof db;
        await lockPostgresCoalescingGroups(transaction, input, possibleGroups);
        const deliveryId = idempotentDeliveryId(input);
        let receipt = await transaction.query.notificationDeliveries.findFirst({
          where: eq(notificationDeliveries.id, deliveryId),
        });
        if (!receipt) {
          const [inserted] = await transaction
            .insert(notificationDeliveries)
            .values({ id: deliveryId, userId: input.userId })
            .onConflictDoNothing({ target: notificationDeliveries.id })
            .returning({ id: notificationDeliveries.id });
          if (inserted) {
            // Record a tombstone receipt even when policy suppresses storage.
            // Otherwise a concurrently prepared heuristic agent_stuck could
            // materialize after the authoritative exact callback completed.
            if (!decision.store) {
              return { notification: null, created: false };
            }
            const notification = await upsertCoalesced(input, severity, transaction);
            await transaction
              .update(notificationDeliveries)
              .set({ notificationId: notification.id })
              .where(eq(notificationDeliveries.id, deliveryId));
            return { notification, created: true };
          }
          // Defensive rolling-upgrade path: an older process may have claimed
          // the delivery using a narrower advisory-lock set.
          receipt = await transaction.query.notificationDeliveries.findFirst({
            where: eq(notificationDeliveries.id, deliveryId),
          });
        }
        if (!receipt?.notificationId) {
          return { notification: null, created: false };
        }

        const source = await transaction.query.notificationEvents.findFirst({
          where: and(
            eq(notificationEvents.id, receipt.notificationId),
            eq(notificationEvents.userId, input.userId),
          ),
        });
        if (!source) return { notification: null, created: false };

        // A legacy heuristic row may need to move from lifecycle to failure. If
        // that destination already has an open aggregate, merge and repoint every
        // delivery before deleting the source so the one-open-row invariant and
        // exact retry identity both survive the transition.
        if (
          input.sessionId &&
          source.readAt === null &&
          source.coalesceKey !== destinationGroup
        ) {
          const cutoff = new Date(Date.now() - COALESCE_WINDOW_MS);
          const destination = await transaction.query.notificationEvents.findFirst({
            where: and(
              eq(notificationEvents.userId, input.userId),
              eq(notificationEvents.sessionId, input.sessionId),
              eq(notificationEvents.coalesceKey, destinationGroup),
              isNull(notificationEvents.readAt),
              gt(notificationEvents.updatedAt, cutoff),
            ),
          });
          if (destination) {
            const [merged] = await transaction
              .update(notificationEvents)
              .set({
                sessionName: input.sessionName ?? source.sessionName,
                type: input.type,
                severity,
                title: input.title,
                body: input.body ?? null,
                meta: input.meta ?? null,
                count: sql`${notificationEvents.count} + ${source.count ?? 1}`,
                updatedAt: new Date(),
              })
              .where(eq(notificationEvents.id, destination.id))
              .returning();
            await transaction
              .update(notificationDeliveries)
              .set({ notificationId: destination.id })
              .where(eq(notificationDeliveries.notificationId, source.id));
            await transaction
              .delete(notificationEvents)
              .where(eq(notificationEvents.id, source.id));
            return {
              notification: merged ? mapRow(merged) : null,
              created: false,
            };
          }
        }

        const [updated] = await transaction
          .update(notificationEvents)
          .set({
            sessionName: input.sessionName ?? null,
            type: input.type,
            severity,
            title: input.title,
            body: input.body ?? null,
            coalesceKey: destinationGroup,
            meta: input.meta ?? null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(notificationEvents.id, receipt.notificationId),
            eq(notificationEvents.userId, input.userId),
          ))
          .returning();
        return {
          notification: updated ? mapRow(updated) : null,
          created: false,
        };
      }),
  );

  if (outcome.created && outcome.notification && decision.push) {
    if (pushGateway && pushTokenRepo) {
      dispatchPush(outcome.notification).catch((err) =>
        log.warn("Push notification dispatch failed", { error: String(err) }),
      );
    }
  }
  return outcome.notification;
}

/** Periodic bounded retention for exact-delivery receipts. */
export async function pruneLifecycleDeliveryReceipts(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - LIFECYCLE_RECEIPT_RETENTION_MS);
  await withBusyRetry(
    () => db.delete(notificationDeliveries).where(ltDate(notificationDeliveries.createdAt, cutoff)),
    { label: "prune notification delivery receipts" },
  );
  await withBusyRetry(
    () => db.delete(agentStatusDeliveries).where(ltDate(agentStatusDeliveries.createdAt, cutoff)),
    { label: "prune agent status delivery receipts" },
  );
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
  database: typeof db = db,
): Promise<NotificationEvent> {
  const coalesceKey = notificationGroup(input.type);
  const cutoff = new Date(Date.now() - COALESCE_WINDOW_MS);

  const existing = input.sessionId
    ? await database.query.notificationEvents.findFirst({
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
    const [updated] = await database
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

  const [row] = await database
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
