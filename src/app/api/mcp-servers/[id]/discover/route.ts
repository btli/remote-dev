import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as MCPDiscoveryService from "@/services/mcp-discovery-service";

/**
 * POST /api/mcp-servers/:id/discover - Trigger discovery for a specific server
 *
 * Query params:
 * - refresh: If "true", clear cache and re-discover
 */
export const POST = withAuth(async (request, { userId, params }) => {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get("refresh") === "true";

  try {
    const result = refresh
      ? await MCPDiscoveryService.refreshServer(params!.id, userId)
      : await MCPDiscoveryService.discoverServer(params!.id, userId);

    if (result.error) {
      return NextResponse.json(result, { status: 207 }); // Multi-Status
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MCPDiscoveryService.MCPDiscoveryError) {
      return errorResponse(error.message, 404, error.code);
    }
    throw error;
  }
});

/**
 * DELETE /api/mcp-servers/:id/discover - Clear discovery cache for a server
 */
export const DELETE = withAuth(async (_request, { params }) => {
  await MCPDiscoveryService.clearServerDiscovery(params!.id);
  return NextResponse.json({ success: true });
});
