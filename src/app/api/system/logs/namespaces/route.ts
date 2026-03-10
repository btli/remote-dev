/**
 * Log Namespaces API
 *
 * GET /api/system/logs/namespaces - Get distinct log namespaces for filter dropdowns
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { logRepository } from "@/infrastructure/container";

export const GET = withApiAuth(async () => {
  try {
    const namespaces = logRepository.getNamespaces();
    return NextResponse.json({ namespaces });
  } catch {
    return errorResponse("Failed to fetch namespaces", 500);
  }
});
