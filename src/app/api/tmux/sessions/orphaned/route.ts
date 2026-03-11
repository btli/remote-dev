/**
 * Orphaned Tmux Sessions API Routes
 *
 * DELETE /api/tmux/sessions/orphaned - Terminate all orphaned tmux sessions
 */

import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { killOrphanedSessionsUseCase } from "@/infrastructure/container";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/tmux");

/**
 * DELETE /api/tmux/sessions/orphaned
 *
 * Terminate all orphaned tmux sessions (sessions without a DB record).
 * Returns the list of terminated session names and any errors encountered.
 */
export const DELETE = withAuth(async (_request, { userId }) => {
  try {
    const result = await killOrphanedSessionsUseCase.execute({ userId });

    return NextResponse.json({
      success: result.success,
      killedCount: result.killedCount,
      killedSessionNames: result.killedSessionNames,
      errors: result.errors,
    });
  } catch (error) {
    log.error("Failed to clean up orphaned sessions", { error: String(error) });
    return errorResponse("Failed to clean up orphaned sessions", 500);
  }
});
