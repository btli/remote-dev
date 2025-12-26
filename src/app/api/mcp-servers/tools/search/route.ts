import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as MCPDiscoveryService from "@/services/mcp-discovery-service";

/**
 * GET /api/mcp-servers/tools/search - Search discovered tools by name or description
 *
 * Query params:
 * - q: Search query (required)
 */
export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (!query) {
    return errorResponse("Query parameter 'q' is required", 400);
  }

  const tools = await MCPDiscoveryService.searchTools(userId, query);
  return NextResponse.json({ tools, query });
});
