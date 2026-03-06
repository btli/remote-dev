import { useCallback, useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

function getPermission(): NotificationPermission {
  if (typeof window !== "undefined" && "Notification" in window) {
    return Notification.permission;
  }
  return "default";
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

export function useNotificationPermission() {
  const permissionState = useSyncExternalStore(
    subscribe,
    getPermission,
    () => "default" as NotificationPermission
  );

  const requestPermission = useCallback(async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      const permission = await Notification.requestPermission();
      notifyListeners();
      return permission;
    }
    return "denied" as NotificationPermission;
  }, []);

  return { permissionState, requestPermission };
}

export function sendBrowserNotification(options: {
  title: string;
  body: string;
  tag: string;
  onClick?: () => void;
}): void {
  try {
    const notification = new Notification(options.title, {
      body: options.body,
      icon: "/favicon.ico",
      tag: options.tag,
    });

    notification.onclick = () => {
      window.focus();
      options.onClick?.();
      notification.close();
    };

    setTimeout(() => notification.close(), 5000);
  } catch {
    // Notification API unavailable in this environment
  }
}
