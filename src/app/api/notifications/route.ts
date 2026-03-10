import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as NotificationService from "@/services/notification-service";

// POST /api/notifications - create notification
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      sessionId?: string;
      type?: string;
      title?: string;
      body?: string;
    }>(request);
    if ("error" in result) return result.error;
    const { sessionId, type, title, body } = result.data;

    if (!title) {
      return errorResponse("title is required", 400);
    }

    const notification = await NotificationService.createNotification({
      userId,
      sessionId: sessionId ?? undefined,
      type: (type ?? "info") as import("@/types/notification").NotificationType,
      title,
      body: body ?? undefined,
    });
    return NextResponse.json(notification ?? { debounced: true });
  } catch (error) {
    console.error("Error creating notification:", error);
    return errorResponse("Failed to create notification", 500);
  }
});

// GET /api/notifications?limit=50&unreadOnly=false
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10);
    const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(1, rawLimit), 200);
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const [notifications, unreadCount] = await Promise.all([
      NotificationService.listNotifications(userId, { limit, unreadOnly }),
      NotificationService.getUnreadCount(userId),
    ]);
    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error("Error listing notifications:", error);
    return errorResponse("Failed to list notifications", 500);
  }
});

// PATCH /api/notifications - mark read
export const PATCH = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{ ids?: string[]; all?: boolean }>(request);
    if ("error" in result) return result.error;
    const { ids, all } = result.data;

    if (all) {
      await NotificationService.markAllRead(userId);
    } else if (ids?.length) {
      await NotificationService.markRead(userId, ids);
    } else {
      return errorResponse("Must provide ids or all=true", 400);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error marking notifications read:", error);
    return errorResponse("Failed to update notifications", 500);
  }
});

// DELETE /api/notifications - hard delete one or all
export const DELETE = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{ ids?: string[]; all?: boolean }>(request);
    if ("error" in result) return result.error;
    const { ids, all } = result.data;

    if (all) {
      await NotificationService.deleteAllNotifications(userId);
    } else if (ids?.length) {
      await NotificationService.deleteNotifications(userId, ids);
    } else {
      return errorResponse("Must provide ids or all=true", 400);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting notifications:", error);
    return errorResponse("Failed to delete notifications", 500);
  }
});
