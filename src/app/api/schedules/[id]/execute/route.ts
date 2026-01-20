import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as ScheduleService from "@/services/schedule-service";

/**
 * POST /api/schedules/:id/execute - Trigger manual execution
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  try {
    const scheduleId = params?.id;
    if (!scheduleId) {
      return errorResponse("Schedule ID is required", 400, "ID_REQUIRED");
    }

    const execution = await ScheduleService.executeScheduleNow(
      scheduleId,
      userId
    );

    return NextResponse.json({
      success: true,
      execution,
    });
  } catch (error) {
    console.error("Error executing schedule:", error);
    if (error instanceof ScheduleService.ScheduleServiceError) {
      let status: number;
      switch (error.code) {
        case "SCHEDULE_NOT_FOUND":
        case "SESSION_NOT_FOUND":
          status = 404;
          break;
        case "SESSION_CLOSED":
          status = 400;
          break;
        default:
          status = 500;
      }
      return errorResponse(error.message, status, error.code);
    }
    return errorResponse("Failed to execute schedule", 500);
  }
});
