import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as DevServerService from "@/services/dev-server-service";

/**
 * GET /api/dev-servers/[folderId] - Get dev server status for a folder
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const folderId = params?.folderId;

  if (!folderId) {
    return errorResponse("folderId is required", 400);
  }

  const state = await DevServerService.getDevServerState(folderId, userId);

  if (!state) {
    return NextResponse.json({
      running: false,
      config: await DevServerService.getDevServerConfig(folderId, userId),
    });
  }

  return NextResponse.json({
    running: true,
    ...state,
  });
});

/**
 * DELETE /api/dev-servers/[folderId] - Stop the dev server for a folder
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
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
    await DevServerService.stopDevServer(devServer.id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof DevServerService.DevServerServiceError) {
      return errorResponse(error.message, 500);
    }
    throw error;
  }
});
