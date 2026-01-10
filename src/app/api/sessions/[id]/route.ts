import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";
import { resolve } from "path";

/**
 * Validate a project path to prevent path traversal attacks.
 * SECURITY: Ensures paths are within allowed directories.
 */
function validateProjectPath(path: string | undefined): string | undefined {
  if (!path) return undefined;

  if (!path.startsWith("/")) {
    return undefined;
  }

  const resolved = resolve(path);
  const home = process.env.HOME || "/tmp";
  if (!resolved.startsWith(home) && !resolved.startsWith("/tmp")) {
    return undefined;
  }

  return resolved;
}

/**
 * GET /api/sessions/:id - Get a single session
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sessions/${params!.id}`,
  });
});

/**
 * PATCH /api/sessions/:id - Update a session
 *
 * Proxies to rdv-server. Path validation done here for security.
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const sessionId = params!.id;

  const result = await parseJsonBody<{
    name?: string;
    status?: string;
    tabOrder?: number;
    projectPath?: string;
  }>(request);
  if ("error" in result) return result.error;
  const body = result.data;

  // SECURITY: Validate projectPath to prevent path traversal
  if (body.projectPath !== undefined) {
    const validatedPath = validateProjectPath(body.projectPath);
    if (body.projectPath && !validatedPath) {
      return errorResponse("Invalid project path", 400, "INVALID_PATH");
    }
    body.projectPath = validatedPath;
  }

  // Create new request with validated body
  const proxyRequest = new Request(request.url, {
    method: "PATCH",
    headers: request.headers,
    body: JSON.stringify({
      name: body.name,
      folder_id: body.projectPath, // Note: rdv-server uses folder_id for moves
    }),
  });

  return proxyToRdvServer(proxyRequest, userId, {
    path: `/sessions/${sessionId}`,
  });
});

/**
 * DELETE /api/sessions/:id - Close a session
 *
 * Proxies to rdv-server. The following cleanup is handled by rdv-server:
 * - Learning extraction (transcript capture and pattern analysis)
 * - Worktree cleanup (git worktree remove)
 * - tmux session termination
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  const response = await proxyToRdvServer(request, userId, {
    path: `/sessions/${params!.id}`,
  });

  // Transform response: rdv-server returns 204, frontend expects { success: true }
  if (response.status === 204) {
    return NextResponse.json({ success: true });
  }

  return response;
});
