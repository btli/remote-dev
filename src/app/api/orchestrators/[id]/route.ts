import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/orchestrators/[id] - Get orchestrator details
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/orchestrators/${params!.id}`,
  });
});

/**
 * PATCH /api/orchestrators/[id] - Update orchestrator
 *
 * Proxies to rdv-server.
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/orchestrators/${params!.id}`,
  });
});

/**
 * DELETE /api/orchestrators/[id] - Delete orchestrator
 *
 * Proxies to rdv-server.
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/orchestrators/${params!.id}`,
  });
});
