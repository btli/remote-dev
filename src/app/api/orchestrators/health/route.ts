import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/orchestrators/health - Get health metrics for all orchestrators
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/orchestrators/health",
  });
});
