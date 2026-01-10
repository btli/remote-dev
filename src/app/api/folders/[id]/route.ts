import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/folders/:id - Get a specific folder
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/folders/${params!.id}`,
  });
});

/**
 * PATCH /api/folders/:id - Update a folder (or move to new parent)
 *
 * Proxies to rdv-server.
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/folders/${params!.id}`,
  });
});

/**
 * DELETE /api/folders/:id - Delete a folder
 *
 * Proxies to rdv-server.
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  const response = await proxyToRdvServer(request, userId, {
    path: `/folders/${params!.id}`,
  });

  // Transform 204 No Content to JSON response for frontend
  if (response.status === 204) {
    return NextResponse.json({ success: true });
  }

  return response;
});
