import { NextResponse } from "next/server";
import * as TrashService from "@/services/trash-service";

/**
 * POST /api/cron/trash-cleanup - Scheduled cleanup of expired trash items
 *
 * This endpoint can be called by an external cron job (e.g., Vercel Cron, GitHub Actions).
 * Supports two authentication methods:
 * 1. Authorization header: `Bearer <CRON_SECRET>`
 * 2. Query param: `?secret=<CRON_SECRET>`
 *
 * Set CRON_SECRET in your environment variables.
 * If CRON_SECRET is not set, the endpoint is disabled for security.
 */
export async function POST(request: Request) {
  try {
    // Verify cron secret
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.warn("[Cron] CRON_SECRET not configured - cron endpoint disabled");
      return NextResponse.json(
        { error: "Cron endpoint not configured" },
        { status: 503 }
      );
    }

    // Check Authorization header
    const authHeader = request.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    // Check query param fallback
    const { searchParams } = new URL(request.url);
    const querySecret = searchParams.get("secret");

    const providedSecret = bearerToken || querySecret;

    if (providedSecret !== cronSecret) {
      console.warn("[Cron] Invalid or missing cron secret");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Run cleanup
    console.log("[Cron] Running scheduled trash cleanup...");
    const result = await TrashService.cleanupExpiredItems();

    console.log(`[Cron] Cleanup complete: ${result.deletedCount} items deleted`);

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Cron] Trash cleanup failed:", error);
    return NextResponse.json(
      { error: "Cleanup failed" },
      { status: 500 }
    );
  }
}

// Also support GET for simpler cron integrations (e.g., Vercel Cron)
export async function GET(request: Request) {
  return POST(request);
}
