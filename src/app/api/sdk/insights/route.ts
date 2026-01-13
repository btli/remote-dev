/**
 * SDK Insights API Routes
 *
 * Provides read and management operations for extracted insights.
 * Insights are consolidated knowledge extracted from notes and session analysis.
 *
 * Proxies to rdv-server for all operations.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/sdk/insights - Create a new insight manually
 *
 * Proxies to rdv-server.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/sdk/insights",
  });
});

/**
 * GET /api/sdk/insights - Query insights with folder inheritance
 *
 * Insights are folder-scoped with inheritance from parent folders.
 * When querying a subfolder, insights from all ancestor folders are included.
 *
 * Query params:
 * - folderId: Filter by folder (includes inherited insights from ancestors)
 * - type: Filter by insight type
 * - applicability: Filter by applicability scope
 * - applicabilityContext: Filter by specific context (e.g., "typescript")
 * - search: Search in title and description
 * - minConfidence: Minimum confidence score
 * - verified: Filter by verified status (true/false)
 * - active: Filter by active status (true/false) - default: true
 * - sortBy: Sort field (createdAt, confidence, applicationCount, feedbackScore)
 * - sortOrder: asc or desc - default: desc
 * - limit: Max results - default: 50
 * - inherit: Enable folder inheritance (default: true)
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/sdk/insights",
  });
});
