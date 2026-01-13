/**
 * Agent Profile Config by Type API
 *
 * GET /api/agent-profiles/:id/configs/:agentType - Get config
 * PUT /api/agent-profiles/:id/configs/:agentType - Create/replace config
 * PATCH /api/agent-profiles/:id/configs/:agentType - Partial update
 * DELETE /api/agent-profiles/:id/configs/:agentType - Delete config
 *
 * Proxies to rdv-server at /profiles/:id/configs/:agentType.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";
import { NextResponse } from "next/server";

/**
 * GET /api/agent-profiles/:id/configs/:agentType
 * Get configuration for a specific agent type
 */
export const GET = withAuth(async (request, { userId, params }) => {
  const profileId = params?.id;
  const agentType = params?.agentType;
  if (!profileId || !agentType) {
    return NextResponse.json(
      { error: "Profile ID and agent type required" },
      { status: 400 }
    );
  }
  return proxyToRdvServer(request, userId, {
    path: `/profiles/${profileId}/configs/${agentType}`,
  });
});

/**
 * PUT /api/agent-profiles/:id/configs/:agentType
 * Create or replace configuration for a specific agent type
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const profileId = params?.id;
  const agentType = params?.agentType;
  if (!profileId || !agentType) {
    return NextResponse.json(
      { error: "Profile ID and agent type required" },
      { status: 400 }
    );
  }
  return proxyToRdvServer(request, userId, {
    path: `/profiles/${profileId}/configs/${agentType}`,
  });
});

/**
 * PATCH /api/agent-profiles/:id/configs/:agentType
 * Partially update configuration
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const profileId = params?.id;
  const agentType = params?.agentType;
  if (!profileId || !agentType) {
    return NextResponse.json(
      { error: "Profile ID and agent type required" },
      { status: 400 }
    );
  }
  return proxyToRdvServer(request, userId, {
    path: `/profiles/${profileId}/configs/${agentType}`,
  });
});

/**
 * DELETE /api/agent-profiles/:id/configs/:agentType
 * Delete configuration for a specific agent type
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  const profileId = params?.id;
  const agentType = params?.agentType;
  if (!profileId || !agentType) {
    return NextResponse.json(
      { error: "Profile ID and agent type required" },
      { status: 400 }
    );
  }
  return proxyToRdvServer(request, userId, {
    path: `/profiles/${profileId}/configs/${agentType}`,
  });
});
