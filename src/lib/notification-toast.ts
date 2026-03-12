import { toast } from "sonner";
import type { NotificationEvent, NotificationType } from "@/types/notification";

type ToastVariant = "default" | "error" | "success" | "warning";

const TYPE_TO_VARIANT: Record<NotificationType, ToastVariant> = {
  agent_error: "error",
  build_fail: "error",
  agent_complete: "success",
  agent_exited: "default",
  agent_waiting: "warning",
  session_closed: "default",
  info: "default",
};

/** Maps sessionId → active toast IDs so they can be dismissed when the session is selected */
const sessionToastIds = new Map<string, Set<string | number>>();

/** Dismiss all active toasts for a given session */
export function dismissToastsForSession(sessionId: string): void {
  const toastIds = sessionToastIds.get(sessionId);
  if (!toastIds) return;
  for (const id of toastIds) {
    toast.dismiss(id);
  }
  sessionToastIds.delete(sessionId);
}

function trackToast(sessionId: string, toastId: string | number): void {
  let ids = sessionToastIds.get(sessionId);
  if (!ids) {
    ids = new Set();
    sessionToastIds.set(sessionId, ids);
  }
  ids.add(toastId);
}

export function fireNotificationToast(
  notification: NotificationEvent,
  onJumpToSession: ((sessionId: string) => void) | null,
  onMarkRead: ((ids: string[]) => void) | null
): void {
  const variant = TYPE_TO_VARIANT[notification.type];
  const description = notification.body ?? notification.sessionName ?? undefined;
  const action =
    notification.sessionId && onJumpToSession
      ? {
          label: "View session",
          onClick: () => {
            onJumpToSession(notification.sessionId!);
            if (!notification.readAt) {
              onMarkRead?.([notification.id]);
            }
          },
        }
      : undefined;

  const options = {
    description,
    action,
    duration: 5000,
    onDismiss: () => {
      // Clean up tracking when toast is dismissed (auto or manual)
      if (notification.sessionId) {
        const ids = sessionToastIds.get(notification.sessionId);
        if (ids) {
          ids.delete(toastId);
          if (ids.size === 0) sessionToastIds.delete(notification.sessionId);
        }
      }
    },
  };

  let toastId: string | number;

  switch (variant) {
    case "error":
      toastId = toast.error(notification.title, options);
      break;
    case "success":
      toastId = toast.success(notification.title, options);
      break;
    case "warning":
      toastId = toast.warning(notification.title, options);
      break;
    default:
      toastId = toast(notification.title, options);
  }

  if (notification.sessionId) {
    trackToast(notification.sessionId, toastId);
  }
}
