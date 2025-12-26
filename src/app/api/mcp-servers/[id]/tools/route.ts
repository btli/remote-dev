import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import * as MCPDiscoveryService from "@/services/mcp-discovery-service";

/**
 * GET /api/mcp-servers/:id/tools - Get discovered tools for a specific server
 */
export const GET = withAuth(async (_request, { params }) => {
  const tools = await MCPDiscoveryService.getServerTools(params!.id);
  return NextResponse.json({ tools });
});
