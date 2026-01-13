/**
 * SDK Memory API Routes
 *
 * Provides CRUD operations for the hierarchical memory system.
 * Proxies to rdv-server for all operations.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/sdk/memory - Store a new memory entry
 *
 * Proxies to rdv-server at /memory.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/memory",
  });
});

/**
 * GET /api/sdk/memory - Query memories with filters
 *
 * Query params:
 * - tier: Filter by memory tier
 * - contentType: Filter by content type
 * - sessionId: Filter by session
 * - folderId: Filter by folder (includes inherited memories)
 * - taskId: Filter by task
 * - minRelevance: Minimum relevance score
 * - minConfidence: Minimum confidence score
 * - limit: Max results
 *
 * Proxies to rdv-server at /memory.
 */
export const GET = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/memory",
  });
});
