import { useCallback, useEffect, useRef, useState } from "react";

interface NotificationOptions {
  /** Time in ms of inactivity before notifying (default: 5000ms) */
  inactivityDelay?: number;
  /** Whether notifications are enabled */
  enabled?: boolean;
  /** Session name to show in notification */
  sessionName?: string;
}

export function useNotifications({
  inactivityDelay = 5000,
  enabled = true,
  sessionName = "Terminal",
}: NotificationOptions = {}) {
  const [permissionState, setPermissionState] = useState<NotificationPermission>(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      return Notification.permission;
    }
    return "default";
  });
  const lastActivityRef = useRef<number>(0);
  const wasActiveRef = useRef<boolean>(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifiedRef = useRef<boolean>(false);

  // Request notification permission
  const requestPermission = useCallback(async () => {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      return permission;
    }
    return "denied" as NotificationPermission;
  }, []);

  // Send a notification
  const notify = useCallback(
    (title: string, body?: string) => {
      if (!enabled || permissionState !== "granted") return;

      // Don't notify if the window is focused
      if (document.hasFocus()) return;

      const notification = new Notification(title, {
        body,
        icon: "/favicon.ico",
        tag: `terminal-${sessionName}`, // Prevents duplicate notifications
      });

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);

      // Focus window when notification is clicked
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    },
    [enabled, permissionState, sessionName]
  );

  // Record terminal activity
  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    wasActiveRef.current = true;
    notifiedRef.current = false;

    // Clear any pending notification timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set a new timeout to check for inactivity
    if (enabled && permissionState === "granted") {
      timeoutRef.current = setTimeout(() => {
        const timeSinceActivity = Date.now() - lastActivityRef.current;

        // If still inactive and was previously active, notify
        if (
          timeSinceActivity >= inactivityDelay &&
          wasActiveRef.current &&
          !notifiedRef.current
        ) {
          notify(`${sessionName} - Command finished`, "Your command has completed.");
          notifiedRef.current = true;
          wasActiveRef.current = false;
        }
      }, inactivityDelay);
    }
  }, [enabled, permissionState, inactivityDelay, notify, sessionName]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    permissionState,
    requestPermission,
    recordActivity,
    notify,
  };
}
