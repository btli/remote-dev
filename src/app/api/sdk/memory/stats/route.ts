/**
 * SDK Memory Stats API
 *
 * Provides statistics about memory usage.
 * Proxies to rdv-server for all operations.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/sdk/memory/stats - Get memory statistics
 *
 * Query params:
 * - folderId: Filter by folder
 *
 * Proxies to rdv-server at /memory/stats.
 */
export const GET = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/memory/stats",
  });
});
