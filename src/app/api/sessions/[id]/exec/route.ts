import { withApiAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/sessions/:id/exec - Execute a command in a terminal session
 *
 * Proxies to rdv-server.
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sessions/${params!.id}/exec`,
  });
});
