import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as MCPRegistryService from "@/services/mcp-registry-service";

/**
 * POST /api/mcp-servers/:id/toggle - Toggle MCP server enabled state
 */
export const POST = withAuth(async (request, { userId, params }) => {
  const result = await parseJsonBody<{ enabled: boolean }>(request);
  if ("error" in result) {
    return result.error;
  }

  const { enabled } = result.data;
  if (typeof enabled !== "boolean") {
    return errorResponse("enabled must be a boolean", 400);
  }

  const updated = await MCPRegistryService.toggleServerEnabled(
    params!.id,
    userId,
    enabled
  );

  if (!updated) {
    return errorResponse("Server not found", 404);
  }

  return NextResponse.json(updated);
});
