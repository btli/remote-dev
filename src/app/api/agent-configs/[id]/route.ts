import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentConfigService from "@/services/agent-config-service";

/**
 * DELETE /api/agent-configs/:id - Delete an agent config
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  const deleted = await AgentConfigService.deleteConfig(params!.id, userId);
  if (!deleted) {
    return errorResponse("Config not found", 404);
  }

  return NextResponse.json({ success: true });
});

/**
 * PATCH /api/agent-configs/:id - Update an agent config's content
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const result = await parseJsonBody<{ content: string }>(request);
  if ("error" in result) {
    return result.error;
  }

  const { content } = result.data;
  if (content === undefined || content === null) {
    return errorResponse("content is required", 400);
  }

  // Get the existing config to get its metadata
  const configs = await AgentConfigService.getConfigs(userId);
  const existingConfig = configs.find((c) => c.id === params!.id);

  if (!existingConfig) {
    return errorResponse("Config not found", 404);
  }

  // Update using upsert (which handles the update)
  const updated = await AgentConfigService.upsertConfig(userId, {
    folderId: existingConfig.folderId,
    provider: existingConfig.provider,
    configType: existingConfig.configType,
    content,
  });

  return NextResponse.json(updated);
});
