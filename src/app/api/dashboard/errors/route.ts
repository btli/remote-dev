import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as ActivityDashboardService from "@/services/activity-dashboard-service";

/**
 * GET /api/dashboard/errors - Get recent error events
 *
 * Query params:
 * - limit: Maximum number of errors to return (default: 50)
 */
export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  if (isNaN(limit) || limit < 1 || limit > 200) {
    return errorResponse("limit must be between 1 and 200", 400);
  }

  const errors = await ActivityDashboardService.getErrors(userId, limit);
  return NextResponse.json({
    errors,
    count: errors.length,
  });
});
