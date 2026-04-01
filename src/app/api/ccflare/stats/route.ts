import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as CcflareService from "@/services/ccflare-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/ccflare/stats");

/**
 * GET /api/ccflare/stats - Get ccflare proxy usage statistics
 *
 * Returns request counts, success rate, token usage, cost, and active accounts.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const GET = withAuth(async (_request, { userId: _userId }) => {
  try {
    const stats = await CcflareService.getStats();
    return NextResponse.json(stats);
  } catch (error) {
    log.error("Failed to get ccflare stats", { error: String(error) });
    return errorResponse("Failed to get ccflare stats", 500);
  }
});
