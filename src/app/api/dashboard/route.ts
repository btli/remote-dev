import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ActivityDashboardService from "@/services/activity-dashboard-service";

/**
 * GET /api/dashboard - Get dashboard summary
 *
 * Query params:
 * - days: Number of days to include in summary (default: 30)
 */
export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get("days");
  const days = daysParam ? parseInt(daysParam, 10) : 30;

  if (isNaN(days) || days < 1 || days > 365) {
    return errorResponse("days must be between 1 and 365", 400);
  }

  const summary = await ActivityDashboardService.getDashboardSummary(
    userId,
    days
  );

  return NextResponse.json(summary);
});

/**
 * POST /api/dashboard - Track an activity event
 */
export const POST = withAuth(async (request, { userId }) => {
  const result = await parseJsonBody<ActivityDashboardService.CreateActivityEventInput>(
    request
  );
  if ("error" in result) {
    return result.error;
  }

  const event = await ActivityDashboardService.trackEvent(userId, result.data);
  return NextResponse.json(event, { status: 201 });
});
