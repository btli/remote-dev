import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/folders/:id/orchestrator - Get folder's sub-orchestrator
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/folders/${params!.id}/orchestrator`,
  });
});

/**
 * POST /api/folders/:id/orchestrator - Create or get folder sub-orchestrator
 *
 * Proxies to rdv-server.
 */
export const POST = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/folders/${params!.id}/orchestrator`,
  });
});

/**
 * DELETE /api/folders/:id/orchestrator - Delete folder's sub-orchestrator
 *
 * Proxies to rdv-server.
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/folders/${params!.id}/orchestrator`,
  });
});
