import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as ScheduleService from "@/services/schedule-service";

/**
 * GET /api/schedules/:id/executions - Get execution history
 */
export const GET = withApiAuth(async (request, { userId, params }) => {
  try {
    const scheduleId = params?.id;
    if (!scheduleId) {
      return errorResponse("Schedule ID is required", 400, "ID_REQUIRED");
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);

    const executions = await ScheduleService.getExecutionHistory(
      scheduleId,
      userId,
      Math.min(limit, 100) // Cap at 100
    );

    return NextResponse.json({ executions });
  } catch (error) {
    console.error("Error getting execution history:", error);
    if (error instanceof ScheduleService.ScheduleServiceError) {
      const status = error.code === "SCHEDULE_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }
    return errorResponse("Failed to get execution history", 500);
  }
});
