import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as DevServerService from "@/services/dev-server-service";

/**
 * GET /api/dev-servers - List all active dev servers for the user
 */
export const GET = withAuth(async (_request, { userId }) => {
  const devServers = await DevServerService.getActiveDevServers(userId);
  return NextResponse.json({ devServers });
});

/**
 * POST /api/dev-servers - Start a new dev server for a folder
 *
 * Request body:
 *   - folderId: string (required)
 */
export const POST = withAuth(async (request, { userId }) => {
  const body = await request.json();
  const { folderId } = body;

  if (!folderId || typeof folderId !== "string") {
    return errorResponse("folderId is required", 400);
  }

  try {
    const result = await DevServerService.startDevServer(folderId, userId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof DevServerService.DevServerServiceError) {
      switch (error.code) {
        case "FOLDER_NOT_FOUND":
          return errorResponse("Folder not found", 404);
        case "ALREADY_RUNNING":
          return errorResponse("A dev server is already running for this folder", 409);
        case "NO_STARTUP_COMMAND":
          return errorResponse("No server startup command configured for this folder", 400);
        case "NO_PORT_CONFIGURED":
          return errorResponse("No PORT environment variable configured for this folder", 400);
        default:
          return errorResponse(error.message, 500);
      }
    }
    throw error;
  }
});
