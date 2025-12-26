import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as ActivityDashboardService from "@/services/activity-dashboard-service";

/**
 * GET /api/dashboard/providers - Get stats per agent provider
 *
 * Query params:
 * - days: Number of days to include (default: 30)
 */
export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get("days");
  const days = daysParam ? parseInt(daysParam, 10) : 30;

  if (isNaN(days) || days < 1 || days > 365) {
    return errorResponse("days must be between 1 and 365", 400);
  }

  const stats = await ActivityDashboardService.getProviderStats(userId, days);
  return NextResponse.json({ providers: stats });
});
