import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { getResolvedEnvironment } from "@/services/preferences-service";

/**
 * GET /api/preferences/folders/[folderId]/environment
 *
 * Returns the fully resolved environment variables for a folder,
 * including inheritance from parent folders.
 *
 * Response:
 * {
 *   "variables": { "PORT": "3001", "API_URL": "..." },
 *   "details": [
 *     {
 *       "key": "PORT",
 *       "value": "3001",
 *       "source": { "type": "folder", "folderId": "...", "folderName": "API" },
 *       "isDisabled": false,
 *       "isOverridden": true,
 *       "originalValue": "3000",
 *       "originalSource": { "type": "folder", "folderId": "...", "folderName": "Parent" }
 *     }
 *   ],
 *   "disabledKeys": ["DEBUG"]
 * }
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const folderId = params!.folderId;

  try {
    const resolved = await getResolvedEnvironment(userId, folderId);

    if (!resolved) {
      // Return empty environment if no folder or no env vars
      return NextResponse.json({
        variables: {},
        details: [],
        disabledKeys: [],
      });
    }

    return NextResponse.json(resolved);
  } catch (error) {
    if (error instanceof Error) {
      return errorResponse(error.message, 500);
    }
    throw error;
  }
});
