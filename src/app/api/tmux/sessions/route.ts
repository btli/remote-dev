/**
 * Tmux Sessions API Routes
 *
 * GET /api/tmux/sessions - List all tmux sessions with orphan detection
 * DELETE /api/tmux/sessions?name={name} - Terminate a single tmux session
 */

import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  listTmuxSystemSessionsUseCase,
  killTmuxSessionUseCase,
} from "@/infrastructure/container";
import { TmuxSessionPresenter } from "@/interface/presenters/TmuxSessionPresenter";
import { InvalidValueError } from "@/domain/errors/DomainError";

/**
 * GET /api/tmux/sessions
 *
 * List all tmux sessions on the system, enriched with orphan detection.
 * Returns sessions sorted with orphans first.
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const result = await listTmuxSystemSessionsUseCase.execute({ userId });

    return NextResponse.json(
      TmuxSessionPresenter.toListResponse(result.sessions, {
        total: result.totalCount,
        orphaned: result.orphanedCount,
        tracked: result.trackedCount,
      })
    );
  } catch (error) {
    console.error("Failed to list tmux sessions:", error);
    return errorResponse("Failed to list tmux sessions", 500);
  }
});

/**
 * DELETE /api/tmux/sessions?name={name}
 *
 * Terminate a single tmux session by name.
 * Only allows terminating app-managed sessions (rdv- prefix).
 */
export const DELETE = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const sessionName = searchParams.get("name");

  if (!sessionName) {
    return errorResponse("Missing session name", 400, "MISSING_SESSION_NAME");
  }

  try {
    const result = await killTmuxSessionUseCase.execute({
      sessionName,
      userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InvalidValueError) {
      return errorResponse(error.message, 400, "INVALID_VALUE");
    }
    console.error("Failed to terminate tmux session:", error);
    return errorResponse("Failed to terminate session", 500);
  }
});
