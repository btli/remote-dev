import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import * as MCPDiscoveryService from "@/services/mcp-discovery-service";

/**
 * GET /api/mcp-servers/:id/resources - Get discovered resources for a specific server
 */
export const GET = withAuth(async (_request, { params }) => {
  const resources = await MCPDiscoveryService.getServerResources(params!.id);
  return NextResponse.json({ resources });
});
