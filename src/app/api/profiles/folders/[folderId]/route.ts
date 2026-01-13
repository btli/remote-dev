/**
 * Profile Folder Linking API
 *
 * PUT /api/profiles/folders/:folderId - Link folder to a profile
 * DELETE /api/profiles/folders/:folderId - Unlink folder from profile
 *
 * Proxies to rdv-server at /profiles/folders/:folderId.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";
import { NextResponse } from "next/server";

/**
 * PUT /api/profiles/folders/:folderId - Link folder to a profile
 * Body: { profileId: string }
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const folderId = params?.folderId;
  if (!folderId) {
    return NextResponse.json({ error: "Folder ID required" }, { status: 400 });
  }
  return proxyToRdvServer(request, userId, {
    path: `/profiles/folders/${folderId}`,
  });
});

/**
 * DELETE /api/profiles/folders/:folderId - Unlink folder from profile
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  const folderId = params?.folderId;
  if (!folderId) {
    return NextResponse.json({ error: "Folder ID required" }, { status: 400 });
  }
  return proxyToRdvServer(request, userId, {
    path: `/profiles/folders/${folderId}`,
  });
});
