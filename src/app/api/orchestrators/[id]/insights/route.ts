import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/orchestrators/[id]/insights - List insights for orchestrator
 *
 * Query parameters:
 * - resolved: Filter by resolved status (true/false)
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  const url = new URL(request.url);
  const resolved = url.searchParams.get("resolved");

  let path = `/orchestrators/${params!.id}/insights`;
  if (resolved !== null) {
    path += `?resolved=${resolved}`;
  }

  return proxyToRdvServer(request, userId, { path });
});
