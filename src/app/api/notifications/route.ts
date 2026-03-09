import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as NotificationService from "@/services/notification-service";

// GET /api/notifications?limit=50&unreadOnly=false
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
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
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error marking notifications read:", error);
    return errorResponse("Failed to update notifications", 500);
  }
});
