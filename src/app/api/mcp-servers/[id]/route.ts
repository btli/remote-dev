import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as MCPRegistryService from "@/services/mcp-registry-service";
import type { UpdateMCPServerInput } from "@/types/agent";

/**
 * GET /api/mcp-servers/:id - Get a specific MCP server
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const server = await MCPRegistryService.getServer(params!.id, userId);
  if (!server) {
    return errorResponse("Server not found", 404);
  }

  return NextResponse.json(server);
});

/**
 * PATCH /api/mcp-servers/:id - Update an MCP server
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const result = await parseJsonBody<UpdateMCPServerInput>(request);
  if ("error" in result) {
    return result.error;
  }

  const updated = await MCPRegistryService.updateServer(
    params!.id,
    userId,
    result.data
  );

  if (!updated) {
    return errorResponse("Server not found", 404);
  }

  return NextResponse.json(updated);
});

/**
 * DELETE /api/mcp-servers/:id - Delete an MCP server
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  const deleted = await MCPRegistryService.deleteServer(params!.id, userId);
  if (!deleted) {
    return errorResponse("Server not found", 404);
  }

  return NextResponse.json({ success: true });
});
