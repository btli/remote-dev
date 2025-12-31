import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import { agentProfileConfigService, type AgentConfigType } from "@/services/agent-profile-config-service";
import { db } from "@/db";
import { agentProfiles } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { AgentJsonConfig } from "@/types/agent-config";

interface RouteParams {
  params: Promise<{ id: string; agentType: string }>;
}

const VALID_TYPES: AgentConfigType[] = ["claude", "gemini", "opencode", "codex"];

/**
 * GET /api/agent-profiles/:id/configs/:agentType
 * Get configuration for a specific agent type
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: profileId, agentType } = await params;

  if (!VALID_TYPES.includes(agentType as AgentConfigType)) {
    return NextResponse.json(
      { error: `Invalid agentType. Must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  // Verify profile belongs to user
  const [profile] = await db
    .select()
    .from(agentProfiles)
    .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, session.user.id)));

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const config = await agentProfileConfigService.getConfigWithMetadata(
    profileId,
    agentType as AgentConfigType
  );

  if (!config) {
    return NextResponse.json({ error: "Configuration not found" }, { status: 404 });
  }

  return NextResponse.json({ config });
}

/**
 * PUT /api/agent-profiles/:id/configs/:agentType
 * Create or replace configuration for a specific agent type
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: profileId, agentType } = await params;

  if (!VALID_TYPES.includes(agentType as AgentConfigType)) {
    return NextResponse.json(
      { error: `Invalid agentType. Must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  // Verify profile belongs to user
  const [profile] = await db
    .select()
    .from(agentProfiles)
    .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, session.user.id)));

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const body = await request.json() as { configJson: AgentJsonConfig };

  if (!body.configJson) {
    return NextResponse.json(
      { error: "configJson is required" },
      { status: 400 }
    );
  }

  const config = await agentProfileConfigService.upsertConfig(
    session.user.id,
    profileId,
    agentType as AgentConfigType,
    body.configJson
  );

  return NextResponse.json({ config });
}

/**
 * PATCH /api/agent-profiles/:id/configs/:agentType
 * Partially update configuration for a specific agent type
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: profileId, agentType } = await params;

  if (!VALID_TYPES.includes(agentType as AgentConfigType)) {
    return NextResponse.json(
      { error: `Invalid agentType. Must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  // Verify profile belongs to user
  const [profile] = await db
    .select()
    .from(agentProfiles)
    .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, session.user.id)));

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const body = await request.json() as { updates: Partial<AgentJsonConfig> };

  if (!body.updates) {
    return NextResponse.json(
      { error: "updates is required" },
      { status: 400 }
    );
  }

  const config = await agentProfileConfigService.updateConfigPartial(
    profileId,
    agentType as AgentConfigType,
    body.updates
  );

  if (!config) {
    return NextResponse.json(
      { error: "Configuration not found. Create it first with PUT." },
      { status: 404 }
    );
  }

  return NextResponse.json({ config });
}

/**
 * DELETE /api/agent-profiles/:id/configs/:agentType
 * Delete configuration for a specific agent type
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: profileId, agentType } = await params;

  if (!VALID_TYPES.includes(agentType as AgentConfigType)) {
    return NextResponse.json(
      { error: `Invalid agentType. Must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  // Verify profile belongs to user
  const [profile] = await db
    .select()
    .from(agentProfiles)
    .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, session.user.id)));

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const deleted = await agentProfileConfigService.deleteConfig(
    profileId,
    agentType as AgentConfigType
  );

  return NextResponse.json({ deleted });
}
