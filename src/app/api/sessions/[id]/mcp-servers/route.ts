import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import {
  parseSessionMCPConfig,
  updateMCPServerConfig,
  isMCPSupported,
} from "@/services/agent-mcp-parser-service";
import type { SessionMCPServersResponse, UpdateMCPServerConfigInput } from "@/types/agent-mcp";
import type { AgentProviderType } from "@/types/session";

/**
 * GET /api/sessions/:id/mcp-servers - Get MCP servers for a session
 *
 * Reads MCP server configuration from the session's project directory
 * based on the agent provider (Claude, Gemini, Codex).
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const session = await SessionService.getSession(params!.id, userId);

  if (!session) {
    return errorResponse("Session not found", 404);
  }

  // Only agent sessions have MCP servers
  if (session.terminalType !== "agent") {
    return NextResponse.json({
      sessionId: session.id,
      agentProvider: null,
      projectPath: session.projectPath,
      mcpSupported: false,
      servers: [],
      configFilesChecked: [],
      configFilesFound: [],
      error: "Not an agent session",
    } satisfies SessionMCPServersResponse);
  }

  const agentProvider = session.agentProvider as AgentProviderType;

  // Check if MCP is supported for this agent
  if (!isMCPSupported(agentProvider)) {
    return NextResponse.json({
      sessionId: session.id,
      agentProvider,
      projectPath: session.projectPath,
      mcpSupported: false,
      servers: [],
      configFilesChecked: [],
      configFilesFound: [],
    } satisfies SessionMCPServersResponse);
  }

  // Parse MCP config from project directory
  const config = await parseSessionMCPConfig(
    session.id,
    agentProvider,
    session.projectPath
  );

  return NextResponse.json({
    sessionId: session.id,
    agentProvider,
    projectPath: session.projectPath,
    mcpSupported: config.mcpSupported,
    servers: config.servers,
    configFilesChecked: config.configFilesChecked,
    configFilesFound: config.configFilesFound,
    error: config.error,
  } satisfies SessionMCPServersResponse);
});

/**
 * PATCH /api/sessions/:id/mcp-servers - Update an MCP server config
 *
 * Updates a specific MCP server's configuration (enabled, command, args, env).
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
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

  const result = await parseJsonBody<{
    serverName: string;
    sourceFile: string;
    updates: UpdateMCPServerConfigInput;
  }>(request);

  if ("error" in result) return result.error;
  const { serverName, sourceFile, updates } = result.data;

  if (!serverName || !sourceFile) {
    return errorResponse("serverName and sourceFile are required", 400);
  }

  try {
    await updateMCPServerConfig(agentProvider, sourceFile, serverName, updates);

    // Re-parse and return updated config
    const config = await parseSessionMCPConfig(
      session.id,
      agentProvider,
      session.projectPath
    );

    return NextResponse.json({
      sessionId: session.id,
      agentProvider,
      projectPath: session.projectPath,
      mcpSupported: config.mcpSupported,
      servers: config.servers,
      configFilesChecked: config.configFilesChecked,
      configFilesFound: config.configFilesFound,
    } satisfies SessionMCPServersResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update config";
    return errorResponse(message, 500);
  }
});
