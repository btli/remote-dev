import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import * as MCPRegistryService from "@/services/mcp-registry-service";

/**
 * GET /api/mcp-servers/auto-start - Get servers that should auto-start
 *
 * Returns enabled servers with autoStart=true
 */
export const GET = withAuth(async (_request, { userId }) => {
  const servers = await MCPRegistryService.getAutoStartServers(userId);
  return NextResponse.json({ servers });
});
