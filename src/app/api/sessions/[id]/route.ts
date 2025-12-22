import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import type { UpdateSessionInput } from "@/types/session";

/**
 * GET /api/sessions/:id - Get a single session
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) return errorResponse("Session ID required", 400);

    const terminalSession = await SessionService.getSessionWithMetadata(
      id,
      userId
    );

    if (!terminalSession) {
      return errorResponse("Session not found", 404);
    }

    return NextResponse.json(terminalSession);
  } catch (error) {
    console.error("Error getting session:", error);
    return errorResponse("Failed to get session", 500);
  }
});

/**
 * PATCH /api/sessions/:id - Update a session
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) return errorResponse("Session ID required", 400);

    const body = await request.json();
    const updates: UpdateSessionInput = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.status !== undefined) updates.status = body.status;
    if (body.tabOrder !== undefined) updates.tabOrder = body.tabOrder;
    if (body.projectPath !== undefined) updates.projectPath = body.projectPath;

    const updated = await SessionService.updateSession(id, userId, updates);

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating session:", error);

    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }

    return errorResponse("Failed to update session", 500);
  }
});

/**
 * DELETE /api/sessions/:id - Close a session
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) return errorResponse("Session ID required", 400);

    await SessionService.closeSession(id, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error closing session:", error);

    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }

    return errorResponse("Failed to close session", 500);
  }
});
