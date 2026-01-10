import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/orchestrators - List user's orchestrators
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/orchestrators",
  });
});

/**
 * POST /api/orchestrators - Create a new orchestrator
 *
 * Proxies to rdv-server.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/orchestrators",
  });
});
