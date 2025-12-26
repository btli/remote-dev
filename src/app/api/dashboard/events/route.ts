import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as ActivityDashboardService from "@/services/activity-dashboard-service";

/**
 * GET /api/dashboard/events - Get recent activity events
 *
 * Query params:
 * - limit: Maximum number of events to return (default: 50)
 * - type: Filter by event type (optional)
 */
export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const eventType = searchParams.get("type") as ActivityDashboardService.ActivityEventType | null;
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  if (isNaN(limit) || limit < 1 || limit > 500) {
    return errorResponse("limit must be between 1 and 500", 400);
  }

  let events: ActivityDashboardService.ActivityEvent[];

  if (eventType) {
    events = await ActivityDashboardService.getEventsByType(userId, eventType, limit);
  } else {
    events = await ActivityDashboardService.getRecentEvents(userId, limit);
  }

  return NextResponse.json({ events });
});
