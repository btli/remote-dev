import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as LiteLLMAnalyticsService from "@/services/litellm-analytics-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/litellm/analytics");

/**
 * GET /api/litellm/analytics - Get LiteLLM usage analytics
 *
 * Query params:
 *   type     - "summary" (default) | "timeseries" | "models" | "sessions" | "latency"
 *   start    - ISO date string (default: 30 days ago)
 *   end      - ISO date string (default: now)
 *   model    - optional model filter (for summary, timeseries, latency)
 *   granularity - "hourly" | "daily" (default) | "weekly" (for timeseries)
 *   limit    - max results (for sessions, default 50)
 */
export const GET = withAuth(async (request, { userId: _userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "summary";

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const startDate = searchParams.get("start")
      ? new Date(searchParams.get("start")!)
      : thirtyDaysAgo;
    const endDate = searchParams.get("end")
      ? new Date(searchParams.get("end")!)
      : now;

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return errorResponse("Invalid date format", 400, "INVALID_DATE");
    }

    const model = searchParams.get("model") ?? undefined;

    switch (type) {
      case "summary": {
        const summary = LiteLLMAnalyticsService.getSummary({
          startDate,
          endDate,
          model,
        });
        return NextResponse.json(summary);
      }

      case "timeseries": {
        const granularity =
          (searchParams.get("granularity") as "hourly" | "daily" | "weekly") ??
          "daily";
        if (!["hourly", "daily", "weekly"].includes(granularity)) {
          return errorResponse(
            "Granularity must be hourly, daily, or weekly",
            400,
            "INVALID_GRANULARITY"
          );
        }
        const timeseries = LiteLLMAnalyticsService.getTimeSeries({
          startDate,
          endDate,
          granularity,
          model,
        });
        return NextResponse.json({ timeseries });
      }

      case "models": {
        const models = LiteLLMAnalyticsService.getModelBreakdown({
          startDate,
          endDate,
        });
        return NextResponse.json({ models });
      }

      case "sessions": {
        const limit = searchParams.get("limit")
          ? parseInt(searchParams.get("limit")!, 10)
          : 50;
        const sessions = LiteLLMAnalyticsService.getSessionAttribution({
          startDate,
          endDate,
          limit,
        });
        return NextResponse.json({ sessions });
      }

      case "latency": {
        const latency = LiteLLMAnalyticsService.getLatencyPercentiles({
          startDate,
          endDate,
          model,
        });
        return NextResponse.json({ latency });
      }

      default:
        return errorResponse(
          "Invalid type. Must be one of: summary, timeseries, models, sessions, latency",
          400,
          "INVALID_TYPE"
        );
    }
  } catch (error) {
    log.error("Failed to get LiteLLM analytics", { error: String(error) });
    return errorResponse("Failed to get LiteLLM analytics", 500);
  }
});
