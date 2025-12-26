import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { AGENT_PROVIDERS } from "@/types/session";

/**
 * GET /api/agent-providers - Get available AI agent providers
 *
 * Returns the list of supported AI coding agent providers with their configurations.
 */
export const GET = withAuth(async () => {
  return NextResponse.json({
    providers: AGENT_PROVIDERS,
    // Exclude "none" from the list of actual agents
    agents: AGENT_PROVIDERS.filter((p) => p.id !== "none"),
  });
});
