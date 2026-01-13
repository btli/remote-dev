/**
 * Logs API Routes
 *
 * Provides endpoints for fetching execution logs.
 * Proxies to rdv-server for all operations.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/logs - List execution logs with filters
 *
 * Query params:
 * - sessionId: Filter by session
 * - orchestratorId: Filter by orchestrator
 * - folderId: Filter by folder
 * - level: Filter by log level (info, warn, error)
 * - source: Filter by source (agent, system)
 * - limit: Max results (default 100, max 1000)
 *
 * Proxies to rdv-server at /logs.
 */
export const GET = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/logs",
  });
});
