import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * Folder shape returned by rdv-server (snake_case)
 */
interface RdvFolder {
  id: string;
  name: string;
  parent_id?: string | null;
  sort_order?: number;
  path?: string | null;
  created_at?: string;
  updated_at?: string;
}

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

    // rdv-server may return either:
    // - An array of folders directly, OR
    // - An object with { folders: [...], session_folders: {...} }
    // Frontend expects normalized format: { folders: [...], sessionFolders: {...} }
    let folders: RdvFolder[];
    if (Array.isArray(data)) {
      folders = data;
    } else if (data && typeof data === "object" && Array.isArray(data.folders)) {
      folders = data.folders;
    } else {
      console.error(
        "[folders/route] Unexpected response shape from rdv-server:",
        JSON.stringify(data).slice(0, 200)
      );
      return NextResponse.json(
        { error: "Invalid response from backend", code: "INVALID_RESPONSE" },
        { status: 502 }
      );
    }

    const sessionFolders = data?.session_folders || {};
    return NextResponse.json({
      folders: folders.map((f) => ({
        ...f,
        parentId: f.parent_id ?? null,
        sortOrder: f.sort_order ?? 0,
      })),
      sessionFolders,
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
