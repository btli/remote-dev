/**
 * SDK Memory Entry API Routes
 *
 * Provides single entry operations: get, update, delete.
 * Proxies to rdv-server for all operations.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/sdk/memory/:id - Get a single memory entry
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/memory/${params!.id}`,
  });
});

/**
 * PATCH /api/sdk/memory/:id - Update a memory entry
 *
 * Updatable fields:
 * - tier: Memory tier
 * - priority: Priority score
 * - confidence: Confidence score
 * - relevance: Relevance score
 * - name: Display name
 * - description: Description
 * - ttlSeconds: Time-to-live in seconds
 * - metadata: Custom metadata object
 *
 * Proxies to rdv-server.
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/memory/${params!.id}`,
  });
});

/**
 * DELETE /api/sdk/memory/:id - Delete a memory entry
 *
 * Proxies to rdv-server.
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/memory/${params!.id}`,
  });
});
