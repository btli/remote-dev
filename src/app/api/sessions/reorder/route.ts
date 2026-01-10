import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/sessions/reorder - Reorder sessions (update tab order)
 *
 * Proxies to rdv-server.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/sessions/reorder",
  });
});
