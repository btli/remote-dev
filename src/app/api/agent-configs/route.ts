import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentConfigService from "@/services/agent-config-service";
import type { AgentProvider, AgentConfigType } from "@/types/agent";

const VALID_PROVIDERS: AgentProvider[] = ["claude", "codex", "gemini", "opencode", "all"];
const VALID_CONFIG_TYPES: AgentConfigType[] = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"];

/**
 * GET /api/agent-configs - Get all agent configs for the current user
 *
 * Query params:
 * - folderId: Filter by folder (omit for all, "global" for global only)
 */
export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");

  if (folderId === "global") {
    const configs = await AgentConfigService.getGlobalConfigs(userId);
    return NextResponse.json({ configs });
  }

  if (folderId) {
    const result = await AgentConfigService.getConfigsWithInheritance(userId, folderId);
    return NextResponse.json({
      global: result.global,
      folder: result.folder,
      resolved: Object.fromEntries(result.resolved),
    });
  }

  const configs = await AgentConfigService.getConfigs(userId);
  return NextResponse.json({ configs });
});

/**
 * POST /api/agent-configs - Create or update an agent config
 */
export const POST = withAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{
    folderId?: string;
    provider: AgentProvider;
    configType: AgentConfigType;
    content: string;
  }>(request);

  if ("error" in result) {
    return result.error;
  }

  const { folderId, provider, configType, content } = result.data;

  // Validate provider
  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return errorResponse(
      `Provider must be one of: ${VALID_PROVIDERS.join(", ")}`,
      400
    );
  }

  // Validate configType
  if (!configType || !VALID_CONFIG_TYPES.includes(configType)) {
    return errorResponse(
      `configType must be one of: ${VALID_CONFIG_TYPES.join(", ")}`,
      400
    );
  }

  // Content is required
  if (content === undefined || content === null) {
    return errorResponse("content is required", 400);
  }

  const config = await AgentConfigService.upsertConfig(userId, {
    folderId,
    provider,
    configType,
    content,
  });

  return NextResponse.json(config, { status: 201 });
});
