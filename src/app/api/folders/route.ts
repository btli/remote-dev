import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/folders - Get all folders and session mappings for the current user
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId }) => {
  const response = await proxyToRdvServer(request, userId, {
    path: "/folders",
  });

  // Transform response to match frontend expectations
  if (response.ok) {
    const data = await response.json();
    // rdv-server returns { folders: [...], session_folders: [...] }
    // Frontend expects { folders: [...], sessionFolders: [...] }
    return NextResponse.json({
      folders: data.folders || [],
      sessionFolders: data.session_folders || [],
    });
  }

  return response;
});

/**
 * POST /api/folders - Create a new folder (optionally nested)
 *
 * Proxies to rdv-server.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/folders",
  });
});
