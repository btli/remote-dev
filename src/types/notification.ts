/**
 * Notification types for in-app notification panel
 */

export type NotificationType =
  | "agent_waiting"
  | "agent_error"
  | "agent_complete"
  | "agent_exited"
  | "build_fail"
  | "session_closed"
  | "update_pending"
  | "update_applied"
  | "info";

export interface NotificationEvent {
  id: string;
  userId: string;
  sessionId: string | null;
  sessionName: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  sessionId?: string;
  sessionName?: string;
  type: NotificationType;
  title: string;
  body?: string;
}
