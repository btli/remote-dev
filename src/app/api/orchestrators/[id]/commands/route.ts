import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/orchestrators/[id]/commands - Inject command to a session
 *
 * Allows the orchestrator to send commands to monitored sessions.
 * Includes safety validation and audit logging.
 *
 * Body:
 * - sessionId: Target session ID
 * - command: Command to inject
 *
 * Proxies to rdv-server (maps to /orchestrators/:id/inject).
 */
export const POST = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/orchestrators/${params!.id}/inject`,
  });
});
