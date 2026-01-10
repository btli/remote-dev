import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/orchestrators/[id]/audit - Get audit logs for orchestrator
 *
 * Query parameters:
 * - actionType: Filter by action type
 * - sessionId: Filter by target session ID
 * - startDate: Filter by start date (ISO 8601)
 * - endDate: Filter by end date (ISO 8601)
 * - limit: Max results (default: 100)
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  const url = new URL(request.url);
  const searchParams = new URLSearchParams();

  const actionType = url.searchParams.get("actionType");
  const sessionId = url.searchParams.get("sessionId");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const limit = url.searchParams.get("limit");

  if (actionType) searchParams.set("action_type", actionType);
  if (sessionId) searchParams.set("session_id", sessionId);
  if (startDate) searchParams.set("start_date", startDate);
  if (endDate) searchParams.set("end_date", endDate);
  if (limit) searchParams.set("limit", limit);

  let path = `/orchestrators/${params!.id}/audit`;
  const query = searchParams.toString();
  if (query) {
    path += `?${query}`;
  }

  return proxyToRdvServer(request, userId, { path });
});
