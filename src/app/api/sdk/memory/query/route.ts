/**
 * SDK Memory Query API
 *
 * Provides advanced query operations for memory retrieval with semantic search.
 * Proxies to rdv-server for semantic search with embeddings.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/sdk/memory/query - Advanced memory query with semantic search
 *
 * Request body:
 * - query: Search query string
 * - sessionId: Filter by session
 * - folderId: Filter by folder (includes inherited memories)
 * - taskId: Filter by task
 * - tiers: Array of tiers to include
 * - contentTypes: Array of content types to include
 * - minScore: Minimum similarity score
 * - limit: Max results (default: 50)
 *
 * Proxies to rdv-server's semantic search endpoint at /memory/semantic-search.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/memory/semantic-search",
  });
});
