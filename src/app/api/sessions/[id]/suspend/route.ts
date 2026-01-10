import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/sessions/:id/suspend - Suspend a session
 *
 * Proxies to rdv-server.
 */
export const POST = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sessions/${params!.id}/suspend`,
  });
});
