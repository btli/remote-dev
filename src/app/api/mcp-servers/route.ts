import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as MCPRegistryService from "@/services/mcp-registry-service";
import type { CreateMCPServerInput } from "@/types/agent";

/**
 * GET /api/mcp-servers - Get MCP servers
 *
 * Query params:
 * - folderId: Get servers for specific folder (with inheritance)
 * - global: If "true", get only global servers
 */
export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");
  const globalOnly = searchParams.get("global") === "true";

  if (globalOnly) {
    const servers = await MCPRegistryService.getGlobalServers(userId);
    return NextResponse.json({ servers });
  }

  if (folderId) {
    const result = await MCPRegistryService.getResolvedServers(folderId, userId);
    return NextResponse.json(result);
  }

  // Return all servers
  const servers = await MCPRegistryService.getServers(userId);
  return NextResponse.json({ servers });
});

/**
 * POST /api/mcp-servers - Create a new MCP server
 */
export const POST = withAuth(async (request, { userId }) => {
  const result = await parseJsonBody<CreateMCPServerInput>(request);
  if ("error" in result) {
    return result.error;
  }

  const input = result.data;

  // Validate required fields
  if (!input.name) {
    return errorResponse("name is required", 400);
  }
  if (!input.transport) {
    return errorResponse("transport is required", 400);
  }
  if (!input.command) {
    return errorResponse("command is required", 400);
  }

  const server = await MCPRegistryService.createServer(userId, input);
  return NextResponse.json(server, { status: 201 });
});
