import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import { agentProfileConfigService } from "@/services/agent-profile-config-service";
import { db } from "@/db";
import { agentProfiles } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { AgentJsonConfig } from "@/types/agent-config";
import type { AgentConfigType } from "@/services/agent-profile-config-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/agent-profiles/:id/configs
 * Get all JSON configurations for a profile
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: profileId } = await params;

  // Verify profile belongs to user
  const [profile] = await db
    .select()
    .from(agentProfiles)
    .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, session.user.id)));

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const configs = await agentProfileConfigService.getProfileConfigs(profileId);

  return NextResponse.json({ configs });
}

/**
 * POST /api/agent-profiles/:id/configs
 * Create or update a configuration for a specific agent type
 */
export async function POST(request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: profileId } = await params;

  // Verify profile belongs to user
  const [profile] = await db
    .select()
    .from(agentProfiles)
    .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, session.user.id)));

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const body = await request.json() as {
    agentType: AgentConfigType;
    configJson: AgentJsonConfig;
  };

  if (!body.agentType || !body.configJson) {
    return NextResponse.json(
      { error: "agentType and configJson are required" },
      { status: 400 }
    );
  }

  const validTypes: AgentConfigType[] = ["claude", "gemini", "opencode", "codex"];
  if (!validTypes.includes(body.agentType)) {
    return NextResponse.json(
      { error: `Invalid agentType. Must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  const config = await agentProfileConfigService.upsertConfig(
    session.user.id,
    profileId,
    body.agentType,
    body.configJson
  );

  return NextResponse.json({ config });
}

/**
 * DELETE /api/agent-profiles/:id/configs
 * Delete all configurations for a profile
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: profileId } = await params;

  // Verify profile belongs to user
  const [profile] = await db
    .select()
    .from(agentProfiles)
    .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, session.user.id)));

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const deleted = await agentProfileConfigService.deleteAllProfileConfigs(profileId);

  return NextResponse.json({ deleted });
}
