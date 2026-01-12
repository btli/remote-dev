import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";
import { resolve } from "path";
import * as WorktreeTrashService from "@/services/worktree-trash-service";

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
 * Proxies to rdv-server. Only name and folderId updates are supported.
 * Status changes should use /suspend, /resume, or DELETE endpoints.
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const sessionId = params!.id;

  const result = await parseJsonBody<{
    name?: string;
    folderId?: string | null;
  }>(request);
  if ("error" in result) return result.error;
  const body = result.data;

  // Create new request with validated body
  const proxyRequest = new Request(request.url, {
    method: "PATCH",
    headers: request.headers,
    body: JSON.stringify({
      name: body.name,
      folder_id: body.folderId,
    }),
  });

  return proxyToRdvServer(proxyRequest, userId, {
    path: `/sessions/${sessionId}`,
  });
});

/**
 * DELETE /api/sessions/:id - Close or trash a session
 *
 * Query params:
 * - ?trash=true: Move worktree session to trash instead of closing
 * - ?deleteWorktree=true: Permanently delete the worktree (legacy, proxied to rdv-server)
 *
 * For trash=true, uses WorktreeTrashService which:
 * - Moves the worktree directory to {repoPath}/.trash/{branch}-{timestamp}
 * - Creates trash_item and worktree_trash_metadata database records
 * - Allows later restoration
 *
 * Without trash=true, proxies to rdv-server for standard cleanup.
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  const sessionId = params!.id;
  const url = new URL(request.url);
  const shouldTrash = url.searchParams.get("trash") === "true";

  // Handle worktree trashing (moves to .trash directory for recovery)
  if (shouldTrash) {
    try {
      const trashItem = await WorktreeTrashService.trashWorktreeSession(
        sessionId,
        userId
      );
      return NextResponse.json({
        success: true,
        trashItemId: trashItem.id,
      });
    } catch (error) {
      const err = error as Error & { code?: string };
      // If session doesn't have a worktree, fall through to normal close
      if (err.code === "NO_WORKTREE") {
        // Continue to normal close flow below
      } else if (err.code === "SESSION_NOT_FOUND") {
        return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");
      } else if (err.code === "ALREADY_TRASHED") {
        return errorResponse("Session is already trashed", 400, "ALREADY_TRASHED");
      } else {
        return errorResponse(
          `Failed to trash session: ${err.message}`,
          500,
          err.code || "TRASH_ERROR"
        );
      }
    }
  }

  // Standard close: proxy to rdv-server
  const response = await proxyToRdvServer(request, userId, {
    path: `/sessions/${sessionId}`,
  });

  // Transform response: rdv-server returns 204, frontend expects { success: true }
  if (response.status === 204) {
    return NextResponse.json({ success: true });
  }

  return response;
});
