import { useCallback, useEffect, useRef } from "react";
import { useNotificationPermission, sendBrowserNotification } from "./useNotificationPermission";

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
  const { permissionState, requestPermission } = useNotificationPermission();
  const lastActivityRef = useRef<number>(0);
  const wasActiveRef = useRef<boolean>(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifiedRef = useRef<boolean>(false);

  // Send a notification
  const notify = useCallback(
    (title: string, body?: string) => {
      if (!enabled || permissionState !== "granted") return;
      if (document.hasFocus()) return;

      sendBrowserNotification({
        title,
        body: body ?? "",
        tag: `terminal-${sessionName}`,
      });
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
