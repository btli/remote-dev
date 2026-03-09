"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { NotificationEvent } from "@/types/notification";

/** Hydrate date strings from API response into Date objects */
export function hydrateNotification(raw: Record<string, unknown>): NotificationEvent {
  return {
    ...(raw as unknown as NotificationEvent),
    createdAt: new Date(raw.createdAt as string),
    readAt: raw.readAt ? new Date(raw.readAt as string) : null,
  };
}

interface NotificationContextValue {
  notifications: NotificationEvent[];
  unreadCount: number;
  loading: boolean;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
  addNotification: (notification: NotificationEvent) => void;
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
      console.error("Error fetching notifications:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch notifications on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  const addNotification = useCallback((notification: NotificationEvent) => {
    setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
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
        await refresh();
      }
    },
    [refresh]
  );

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
      await refresh();
    }
  }, [refresh]);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      markRead,
      markAllRead,
      refresh,
      addNotification,
    }),
    [notifications, unreadCount, loading, markRead, markAllRead, refresh, addNotification]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
