import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";
import { resolve } from "path";

/**
 * Validate a project path to prevent path traversal attacks.
 * SECURITY: Ensures paths are within allowed directories.
 */
function validateProjectPath(path: string | undefined): string | undefined {
  if (!path) return undefined;

  // Must be absolute path
  if (!path.startsWith("/")) {
    return undefined;
  }

  // Resolve to canonical path (removes .., ., etc.)
  const resolved = resolve(path);

  // Must be within home directory or /tmp
  const home = process.env.HOME || "/tmp";
  if (!resolved.startsWith(home) && !resolved.startsWith("/tmp")) {
    return undefined;
  }

  return resolved;
}

/**
 * GET /api/sessions - List user's terminal sessions
 *
 * Proxies to rdv-server.
 */
export const GET = withApiAuth(async (request, { userId }) => {
  const response = await proxyToRdvServer(request, userId, {
    path: "/sessions",
  });

  // Transform response: rdv-server returns array, frontend expects { sessions: [] }
  if (response.ok) {
    const sessions = await response.json();
    return NextResponse.json({ sessions: Array.isArray(sessions) ? sessions : [] });
  }

  return response;
});

/**
 * POST /api/sessions - Create a new terminal session
 *
 * Proxies to rdv-server. Path validation done here for security.
 */
export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{
    name?: string;
    projectPath?: string;
    folderId?: string;
    worktreeBranch?: string;
    agentProvider?: string;
    isOrchestratorSession?: boolean;
    shellCommand?: string;
    environment?: Record<string, string>;
  }>(request);
  if ("error" in result) return result.error;
  const body = result.data;

  // SECURITY: Validate projectPath to prevent path traversal
  if (body.projectPath) {
    const validatedPath = validateProjectPath(body.projectPath);
    if (!validatedPath) {
      return errorResponse("Invalid project path", 400, "INVALID_PATH");
    }
    body.projectPath = validatedPath;
  }

  // Create new request with validated body
  const proxyRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({
      name: body.name || "Terminal",
      project_path: body.projectPath,
      folder_id: body.folderId,
      worktree_branch: body.worktreeBranch,
      agent_provider: body.agentProvider,
      is_orchestrator_session: body.isOrchestratorSession,
      shell_command: body.shellCommand,
      environment: body.environment,
    }),
  });

  return proxyToRdvServer(proxyRequest, userId, {
    path: "/sessions",
  });
});
