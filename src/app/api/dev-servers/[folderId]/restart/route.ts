import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as DevServerService from "@/services/dev-server-service";

/**
 * POST /api/dev-servers/[folderId]/restart - Restart the dev server for a folder
 */
export const POST = withAuth(async (_request, { userId, params }) => {
  const folderId = params?.folderId;

  if (!folderId) {
    return errorResponse("folderId is required", 400);
  }

  // Get the dev server for this folder
  const devServer = await DevServerService.getDevServerForFolder(folderId, userId);

  if (!devServer) {
    return errorResponse("No dev server running for this folder", 404);
  }

  try {
    const result = await DevServerService.restartDevServer(devServer.id, userId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DevServerService.DevServerServiceError) {
      return errorResponse(error.message, 500);
    }
    throw error;
  }
});
