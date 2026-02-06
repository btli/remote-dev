import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import {
  parseSessionMCPConfig,
  isMCPSupported,
} from "@/services/agent-mcp-parser-service";
import {
  discoverSessionServer,
  discoverAllSessionServers,
} from "@/services/session-mcp-discovery-service";
import type { AgentProviderType } from "@/types/session";

/**
 * POST /api/sessions/:id/mcp-servers/discover
 *
 * Discover tools and resources from MCP servers configured for a session.
 *
 * Body (optional):
 * - serverName: string - Specific server to discover (omit for all servers)
 * - sourceFile: string - Source file for the server (required if serverName provided)
 *
 * Returns discovery results without persisting to database.
 */
export const POST = withAuth(async (request, { userId, params }) => {
  const session = await SessionService.getSession(params!.id, userId);

  if (!session) {
    return errorResponse("Session not found", 404);
  }

  if (session.terminalType !== "agent") {
    return errorResponse("Not an agent session", 400);
  }

  const agentProvider = session.agentProvider as AgentProviderType;

  if (!isMCPSupported(agentProvider)) {
    return errorResponse("MCP not supported for this agent", 400);
  }

  // Parse current MCP config from files
  const config = await parseSessionMCPConfig(
    session.id,
    agentProvider,
    session.projectPath
  );

  if (config.servers.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // Check if discovering specific server or all
  const result = await parseJsonBody<{
    serverName?: string;
    sourceFile?: string;
  }>(request);

  if ("error" in result) return result.error;
  const { serverName, sourceFile } = result.data;

  if (serverName) {
    // Discover single server
    const server = sourceFile
      ? config.servers.find(
          (s) => s.name === serverName && s.sourceFile === sourceFile
        )
      : config.servers.find((s) => s.name === serverName);

    if (!server) {
      return errorResponse("Server not found in config", 404);
    }

    const discoveryResult = await discoverSessionServer(server);
    return NextResponse.json(discoveryResult);
  } else {
    // Discover all enabled servers
    const discoveryResults = await discoverAllSessionServers(config.servers);
    return NextResponse.json({ results: discoveryResults });
  }
});
