/**
 * SDK Insight Entry API Routes
 *
 * Provides single insight operations: get, update, delete.
 * Proxies to rdv-server for all operations.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/sdk/insights/:id - Get a single insight
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sdk/insights/${params!.id}`,
  });
});

/**
 * PATCH /api/sdk/insights/:id - Update an insight
 *
 * Updatable fields:
 * - type: Insight type
 * - applicability: Applicability scope
 * - applicabilityContext: Specific context
 * - title: Insight title
 * - description: Insight description
 * - confidence: Confidence score (0.0 to 1.0)
 * - verified: Verified status
 * - active: Active status
 *
 * Proxies to rdv-server.
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sdk/insights/${params!.id}`,
  });
});

/**
 * DELETE /api/sdk/insights/:id - Delete an insight
 *
 * Proxies to rdv-server.
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sdk/insights/${params!.id}`,
  });
});

/**
 * POST /api/sdk/insights/:id - Record an insight application
 *
 * Note: rdv-server has this at /sdk/insights/:id/apply
 * Proxies to rdv-server.
 */
export const POST = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sdk/insights/${params!.id}/apply`,
  });
});
