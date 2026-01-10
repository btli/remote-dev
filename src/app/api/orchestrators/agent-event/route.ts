import { proxyToRdvServerNoAuth } from "@/lib/rdv-proxy";

/**
 * GET /api/orchestrators/agent-event
 *
 * Health check endpoint for hooks to verify connectivity.
 * No authentication required - hooks run in trusted local environment.
 *
 * Proxies to rdv-server.
 */
export async function GET(request: Request) {
  return proxyToRdvServerNoAuth(request, {
    path: "/orchestrators/agent-event",
  });
}

/**
 * POST /api/orchestrators/agent-event
 *
 * Receives lifecycle events from agent hooks.
 * This is the primary communication channel from agents to the orchestrator.
 *
 * No authentication required - hooks run in trusted local environment.
 * Security is provided by localhost-only access.
 *
 * Proxies to rdv-server.
 */
export async function POST(request: Request) {
  return proxyToRdvServerNoAuth(request, {
    path: "/orchestrators/agent-event",
  });
}
