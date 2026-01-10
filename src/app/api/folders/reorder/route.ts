import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/folders/reorder - Reorder folders (update sort order)
 *
 * Proxies to rdv-server.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/folders/reorder",
  });
});
