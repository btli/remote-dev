import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import * as MCPDiscoveryService from "@/services/mcp-discovery-service";

/**
 * GET /api/mcp-servers/discovery - Get all discovered tools and resources
 */
export const GET = withAuth(async (_request, { userId }) => {
  const [tools, resources] = await Promise.all([
    MCPDiscoveryService.getDiscoveredTools(userId),
    MCPDiscoveryService.getDiscoveredResources(userId),
  ]);

  // Group tools by server
  const toolsByServer = await MCPDiscoveryService.getToolsByServer(userId);
  const groupedTools: Record<string, typeof tools> = {};
  for (const [serverName, serverTools] of toolsByServer) {
    groupedTools[serverName] = serverTools;
  }

  return NextResponse.json({
    tools,
    resources,
    toolsByServer: groupedTools,
    summary: {
      totalTools: tools.length,
      totalResources: resources.length,
      serverCount: toolsByServer.size,
    },
  });
});

/**
 * POST /api/mcp-servers/discovery - Trigger discovery for all enabled servers
 */
export const POST = withAuth(async (_request, { userId }) => {
  const results = await MCPDiscoveryService.discoverAll(userId);

  const successful = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);

  return NextResponse.json({
    results,
    summary: {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      totalTools: successful.reduce((sum, r) => sum + r.tools.length, 0),
      totalResources: successful.reduce((sum, r) => sum + r.resources.length, 0),
    },
  });
});
