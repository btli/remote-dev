import { useCallback, useSyncExternalStore } from "react";
import { runtimeBasePath } from "@/lib/api-fetch";

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
      // Root-absolute icon path is not basePath-prefixed; resolve under the
      // runtime slug so the notification badge loads on slug instances.
      icon: `${runtimeBasePath()}/favicon.ico`,
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
