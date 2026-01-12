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
 * Transform session from snake_case (rdv-server) to camelCase (frontend).
 */
function transformSession(s: Record<string, unknown>): Record<string, unknown> {
  return {
    id: s.id,
    userId: s.user_id,
    name: s.name,
    tmuxSessionName: s.tmux_session_name,
    projectPath: s.project_path ?? null,
    githubRepoId: s.github_repo_id ?? null,
    worktreeBranch: s.worktree_branch ?? null,
    folderId: s.folder_id ?? null,
    profileId: s.profile_id ?? null,
    agentProvider: s.agent_provider ?? null,
    isOrchestratorSession: s.is_orchestrator_session ?? false,
    splitGroupId: s.split_group_id ?? null,
    splitOrder: s.split_order ?? 0,
    splitSize: s.split_size ?? 100,
    status: s.status,
    tabOrder: s.tab_order ?? 0,
    lastActivityAt: s.last_activity_at ? new Date(s.last_activity_at as number) : new Date(),
    createdAt: s.created_at ? new Date(s.created_at as number) : new Date(),
    updatedAt: s.updated_at ? new Date(s.updated_at as number) : new Date(),
  };
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

  // Transform response: rdv-server returns array in snake_case, frontend expects { sessions: [] } in camelCase
  if (response.ok) {
    const data = await response.json();
    const sessions = Array.isArray(data) ? data : [];
    return NextResponse.json({
      sessions: sessions.map((s: Record<string, unknown>) => transformSession(s)),
    });
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

  const response = await proxyToRdvServer(proxyRequest, userId, {
    path: "/sessions",
  });

  // Transform response from snake_case to camelCase
  if (response.ok) {
    const session = await response.json();
    return NextResponse.json(transformSession(session), { status: response.status });
  }

  return response;
});
