/**
 * Agent Profile Configs API - List all configs for a profile
 *
 * GET /api/agent-profiles/:id/configs - List all agent configurations
 * POST /api/agent-profiles/:id/configs - Create a new agent configuration
 *
 * Proxies to rdv-server at /profiles/:id/configs.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/agent-profiles/:id/configs
 * List all JSON configurations for a profile
 */
export const GET = withAuth(async (request, { userId, params }) => {
  const profileId = params?.id;
  if (!profileId) {
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ error: "Profile ID required" }, { status: 400 });
  }
  return proxyToRdvServer(request, userId, {
    path: `/profiles/${profileId}/configs`,
  });
});

/**
 * POST /api/agent-profiles/:id/configs
 * Create or update a configuration for a specific agent type
 * Body: { agentType: string, configJson: object }
 */
export const POST = withAuth(async (request, { userId, params }) => {
  const profileId = params?.id;
  if (!profileId) {
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ error: "Profile ID required" }, { status: 400 });
  }

  // rdv-server expects PUT to /profiles/{id}/configs/{agent_type}
  // but TypeScript API has POST to /configs with agentType in body
  // So we need to extract agentType and remap
  const body = (await request.clone().json()) as {
    agentType?: string;
    configJson?: unknown;
  };

  if (!body.agentType) {
    const { NextResponse } = await import("next/server");
    return NextResponse.json(
      { error: "agentType is required in body" },
      { status: 400 }
    );
  }

  // Proxy to PUT /profiles/{id}/configs/{agent_type} with body.configJson
  const newBody = JSON.stringify(body.configJson);
  const newRequest = new Request(request.url, {
    method: "PUT",
    headers: request.headers,
    body: newBody,
  });

  return proxyToRdvServer(newRequest, userId, {
    path: `/profiles/${profileId}/configs/${body.agentType}`,
  });
});

/**
 * DELETE /api/agent-profiles/:id/configs
 * Delete all configurations for a profile
 * Note: rdv-server doesn't have this bulk delete - iterate over types
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  const profileId = params?.id;
  if (!profileId) {
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ error: "Profile ID required" }, { status: 400 });
  }

  const { NextResponse } = await import("next/server");

  // Delete each agent type's config
  const agentTypes = ["claude", "gemini", "opencode", "codex"];
  let deletedCount = 0;

  for (const agentType of agentTypes) {
    const deleteRequest = new Request(request.url, {
      method: "DELETE",
      headers: request.headers,
    });

    const response = await proxyToRdvServer(deleteRequest, userId, {
      path: `/profiles/${profileId}/configs/${agentType}`,
    });

    if (response.ok) {
      deletedCount++;
    }
  }

  return NextResponse.json({ deleted: deletedCount });
});
