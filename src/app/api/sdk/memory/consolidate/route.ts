/**
 * SDK Memory Consolidation API
 *
 * Provides memory consolidation operations - promoting frequently accessed
 * short-term memories to working, and working to long-term.
 * Proxies to rdv-server for all operations.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/sdk/memory/consolidate - Consolidate memory entries
 *
 * Promotes memories between tiers based on access patterns and confidence:
 * - short_term → working: if accessCount >= 3 or confidence >= 0.7
 * - working → long_term: if accessCount >= 5 and confidence >= 0.8 and relevance >= 0.7
 *
 * Proxies to rdv-server at /memory/consolidate.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/memory/consolidate",
  });
});
