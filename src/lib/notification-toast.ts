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

  const options = { description, action, duration: 5000 };

  switch (variant) {
    case "error":
      toast.error(notification.title, options);
      break;
    case "success":
      toast.success(notification.title, options);
      break;
    case "warning":
      toast.warning(notification.title, options);
      break;
    default:
      toast(notification.title, options);
  }
}
