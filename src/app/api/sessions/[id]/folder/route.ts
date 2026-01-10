import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * PUT /api/sessions/:id/folder - Move a session to a folder
 *
 * Proxies to rdv-server.
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sessions/${params!.id}/folder`,
  });
});
