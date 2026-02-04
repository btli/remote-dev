/**
 * Session Resources - Read-only access to session data
 *
 * MCP resources provide read access to application data.
 * Resources use URI patterns like rdv://sessions/{id}
 */
import { createResource, extractUriParams } from "../registry.js";
import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";
import type { RegisteredResource } from "../types.js";

/**
 * rdv://sessions - List all sessions
 */
const sessionsListResource = createResource({
  uri: "rdv://sessions",
  name: "Sessions List",
  description: "List all terminal sessions with their status and metadata.",
  mimeType: "application/json",
  handler: async (_uri, context) => {
    const sessions = await SessionService.listSessions(context.userId);

    const data = {
      count: sessions.length,
      sessions: sessions.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        tmuxSessionName: s.tmuxSessionName,
        projectPath: s.projectPath,
        folderId: s.folderId,
        worktreeBranch: s.worktreeBranch,
        terminalType: s.terminalType,
        agentProvider: s.agentProvider,
        agentExitState: s.agentExitState,
        profileId: s.profileId,
        lastActivityAt: s.lastActivityAt,
        createdAt: s.createdAt,
      })),
    };

    return {
      uri: "rdv://sessions",
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    };
  },
});

/**
 * rdv://sessions/{id} - Get session details
 */
const sessionDetailResource = createResource({
  uri: "rdv://sessions/{id}",
  name: "Session Details",
  description: "Get detailed information about a specific terminal session.",
  mimeType: "application/json",
  handler: async (uri, context) => {
    const params = extractUriParams("rdv://sessions/{id}", uri);
    const sessionId = params.id;

    const session = await SessionService.getSessionWithMetadata(
      sessionId,
      context.userId
    );

    if (!session) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          error: "Session not found",
          code: "SESSION_NOT_FOUND",
        }),
      };
    }

    // Check tmux status
    const tmuxExists = await TmuxService.sessionExists(session.tmuxSessionName);

    const data = {
      id: session.id,
      name: session.name,
      status: session.status,
      tmuxSessionName: session.tmuxSessionName,
      tmuxAlive: tmuxExists,
      projectPath: session.projectPath,
      folderId: session.folderId,
      worktreeBranch: session.worktreeBranch,
      repository: session.repository,
      splitGroupId: session.splitGroupId,
      terminalType: session.terminalType,
      agentProvider: session.agentProvider,
      agentExitState: session.agentExitState,
      agentExitCode: session.agentExitCode,
      agentRestartCount: session.agentRestartCount,
      profileId: session.profileId,
      lastActivityAt: session.lastActivityAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };

    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    };
  },
});

/**
 * rdv://sessions/{id}/output - Get session terminal output
 */
const sessionOutputResource = createResource({
  uri: "rdv://sessions/{id}/output",
  name: "Session Output",
  description: "Get the terminal output (scrollback buffer) from a session.",
  mimeType: "text/plain",
  handler: async (uri, context) => {
    const params = extractUriParams("rdv://sessions/{id}/output", uri);
    const sessionId = params.id;

    const session = await SessionService.getSession(sessionId, context.userId);

    if (!session) {
      return {
        uri,
        mimeType: "text/plain",
        text: "Error: Session not found",
      };
    }

    const tmuxExists = await TmuxService.sessionExists(session.tmuxSessionName);

    if (!tmuxExists) {
      return {
        uri,
        mimeType: "text/plain",
        text: "Error: Terminal session no longer exists",
      };
    }

    // Capture output from tmux (last 500 lines)
    const output = await TmuxService.captureOutput(session.tmuxSessionName, 500);

    return {
      uri,
      mimeType: "text/plain",
      text: output,
    };
  },
});

/**
 * Export all session resources
 */
export const sessionResources: RegisteredResource[] = [
  sessionsListResource,
  sessionDetailResource,
  sessionOutputResource,
];
