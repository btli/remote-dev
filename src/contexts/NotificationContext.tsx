"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { NotificationEvent } from "@/types/notification";
import { fireNotificationToast } from "@/lib/notification-toast";

/** Hydrate date strings from API response into Date objects */
export function hydrateNotification(raw: Record<string, unknown>): NotificationEvent {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt as string),
    readAt: raw.readAt ? new Date(raw.readAt as string) : null,
  } as NotificationEvent;
}

/**
 * Result returned by `scheduleDelete`. The actual server delete fires after
 * `delayMs`. Consumers can `cancel()` to abort within the undo window.
 */
export interface ScheduledDelete {
  /** Cancel the pending delete. No-op once the timer has fired. */
  cancel: () => void;
}

interface NotificationContextValue {
  notifications: NotificationEvent[];
  unreadCount: number;
  loading: boolean;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  /**
   * Refresh the notification list from the server. Throws on failure so
   * consumers can render an error banner. Logs internally too.
   */
  refresh: () => Promise<void>;
  addNotification: (notification: NotificationEvent) => void;
  /**
   * Delete a notification immediately on the server. Throws on failure so
   * consumers can react (toast / banner). The optimistic removal from the
   * local list happens regardless; on failure the list is re-fetched so the
   * row reappears.
   *
   * NOTE: For the mobile undo flow, prefer `scheduleDelete` — it owns the
   * timer and the `pendingDeleteIds` set so they survive tab unmounts.
   */
  deleteNotification: (id: string) => Promise<void>;
  deleteAllNotifications: () => Promise<void>;
  registerJumpHandler: (fn: ((sessionId: string) => void) | null) => void;
  /** Session ID with the most recent unread notification, or null */
  latestUnreadSessionId: string | null;

  // ----- Deferred-delete (mobile undo) machinery ----------------------------

  /**
   * IDs that have been swipe-deleted on mobile and are awaiting server
   * commit (5s undo window). Consumers hide these from their lists; the
   * context still holds the underlying notification so Undo can restore it
   * in place without a refetch.
   */
  pendingDeleteIds: ReadonlySet<string>;

  /**
   * Schedule a server delete after `delayMs`. Adds the id to
   * `pendingDeleteIds` so consumers can hide the row optimistically. If the
   * delete fails the id is removed from `pendingDeleteIds` (so the row
   * reappears) and the returned promise rejects via the registered
   * `onError` callback. Returns a handle with a `cancel()` method.
   *
   * Survives unmounts of consumer components — the timer lives in the
   * context provider, which only unmounts when the whole app does.
   */
  scheduleDelete: (
    id: string,
    delayMs: number,
    options?: { onError?: (error: unknown) => void }
  ) => ScheduledDelete;

  /**
   * Cancel a pending scheduled delete by id. Removes the id from
   * `pendingDeleteIds`. No-op if no delete is pending.
   */
  cancelDelete: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotificationContext() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotificationContext must be used within a NotificationProvider"
    );
  }
  return context;
}

interface NotificationProviderProps {
  children: ReactNode;
}

const MAX_NOTIFICATIONS = 200;

export function NotificationProvider({ children }: NotificationProviderProps) {
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [loading, setLoading] = useState(false);

  // Derive unread count from notifications array (single source of truth)
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.readAt).length,
    [notifications]
  );

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/notifications?limit=50");
      if (!response.ok) {
        throw new Error("Failed to fetch notifications");
      }
      const data = await response.json();
      const hydrated = (data.notifications as Record<string, unknown>[]).map(
        hydrateNotification
      );
      setNotifications(hydrated);
    } catch (err) {
      // Log + rethrow so callers (e.g. the mobile error banner) can react.
      console.error("Error fetching notifications:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch notifications on mount. Swallow the rejection here — the initial
  // mount has no UI to surface it; consumers that explicitly call refresh()
  // (pull-to-refresh, retry buttons) get the propagated error.
  useEffect(() => {
    refresh().catch(() => {
      /* surfaced via console.error in refresh() */
    });
  }, [refresh]);

  // Ref for session jump handler — registered by SessionManager, no re-render on change
  const jumpHandlerRef = useRef<((sessionId: string) => void) | null>(null);

  const registerJumpHandler = useCallback((fn: ((sessionId: string) => void) | null) => {
    jumpHandlerRef.current = fn;
  }, []);

  const markReadRef = useRef<((ids: string[]) => void) | null>(null);

  const addNotification = useCallback((notification: NotificationEvent) => {
    setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
    fireNotificationToast(notification, jumpHandlerRef.current, markReadRef.current);
  }, []);

  const markRead = useCallback(
    async (ids: string[]) => {
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) =>
          ids.includes(n.id) ? { ...n, readAt: new Date() } : n
        )
      );

      try {
        const response = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!response.ok) {
          throw new Error("Failed to mark notifications read");
        }
      } catch (err) {
        console.error("Error marking notifications read:", err);
        // Revert on failure
        await refresh().catch(() => {
          /* already logged */
        });
      }
    },
    [refresh]
  );

  // Keep markRead ref in sync for toast action callbacks
  useEffect(() => {
    markReadRef.current = markRead;
  }, [markRead]);

  const markAllRead = useCallback(async () => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date() }))
    );

    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!response.ok) {
        throw new Error("Failed to mark all notifications read");
      }
    } catch (err) {
      console.error("Error marking all notifications read:", err);
      await refresh().catch(() => {
        /* already logged */
      });
    }
  }, [refresh]);

  const deleteNotification = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      try {
        const response = await fetch("/api/notifications", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [id] }),
        });
        if (!response.ok) throw new Error("Failed to delete notification");
      } catch (err) {
        console.error("Error deleting notification:", err);
        // Re-fetch so the row reappears on failure, then propagate so the
        // caller can surface a toast / banner.
        await refresh().catch(() => {
          /* already logged */
        });
        throw err;
      }
    },
    [refresh]
  );

  const deleteAllNotifications = useCallback(async () => {
    setNotifications([]);
    try {
      const response = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!response.ok) throw new Error("Failed to delete all notifications");
    } catch (err) {
      console.error("Error deleting all notifications:", err);
      await refresh().catch(() => {
        /* already logged */
      });
      throw err;
    }
  }, [refresh]);

  // ----- Deferred-delete machinery ------------------------------------------
  //
  // We own the timers and the "pending" set in the provider so they survive
  // when consumer components (e.g. the mobile NotificationsTab) unmount
  // mid-undo-window. Tab navigation in MobileApp swaps tab content by
  // unmount/remount; if the timers lived in the tab they would be silently
  // canceled on tab switch and the row would reappear on next refresh.

  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(
    () => new Set()
  );
  const pendingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Clear all pending timers if the provider itself unmounts (rare — only
  // on full app unmount). Without this, a stray timer could fire after the
  // app has been torn down.
  useEffect(() => {
    const timers = pendingTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const cancelDelete = useCallback((id: string) => {
    const timer = pendingTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      pendingTimersRef.current.delete(id);
    }
    setPendingDeleteIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const scheduleDelete = useCallback<
    NotificationContextValue["scheduleDelete"]
  >(
    (id, delayMs, options) => {
      // If a previous delete for the same id is still pending (double-swipe),
      // clear it first so we don't leak two timers for one row.
      const existing = pendingTimersRef.current.get(id);
      if (existing) clearTimeout(existing);

      setPendingDeleteIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      const timer = setTimeout(() => {
        pendingTimersRef.current.delete(id);
        deleteNotification(id)
          .catch((err) => {
            options?.onError?.(err);
          })
          .finally(() => {
            // Always clear the local hide regardless of server outcome.
            // On success the underlying notification is gone from
            // `notifications`; on failure `refresh()` (inside
            // deleteNotification's catch) restored it, and removing the
            // pending flag lets it render again.
            setPendingDeleteIds((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          });
      }, delayMs);
      pendingTimersRef.current.set(id, timer);

      return {
        cancel: () => cancelDelete(id),
      };
    },
    [deleteNotification, cancelDelete]
  );

  const latestUnreadSessionId = useMemo(() => {
    const unread = notifications
      .filter(n => n.sessionId && !n.readAt)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return unread[0]?.sessionId ?? null;
  }, [notifications]);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      markRead,
      markAllRead,
      refresh,
      addNotification,
      deleteNotification,
      deleteAllNotifications,
      registerJumpHandler,
      latestUnreadSessionId,
      pendingDeleteIds,
      scheduleDelete,
      cancelDelete,
    }),
    [
      notifications,
      unreadCount,
      loading,
      markRead,
      markAllRead,
      refresh,
      addNotification,
      deleteNotification,
      deleteAllNotifications,
      registerJumpHandler,
      latestUnreadSessionId,
      pendingDeleteIds,
      scheduleDelete,
      cancelDelete,
    ]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
