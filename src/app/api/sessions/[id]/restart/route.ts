import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { restartAgentUseCase } from "@/infrastructure/container";
import { SessionPresenter } from "@/interface/presenters/SessionPresenter";
import {
  EntityNotFoundError,
  InvalidStateTransitionError,
} from "@/domain/errors/DomainError";
import { RestartAgentError } from "@/application/use-cases/session/RestartAgentUseCase";
import { broadcastSidebarChanged } from "@/lib/broadcast";

/**
 * POST /api/sessions/:id/restart - Restart an agent session
 */
export const POST = withApiAuth(async (_request, { userId, params }) => {
  try {
    const result = await restartAgentUseCase.execute({
      sessionId: params!.id,
      userId,
    });

    broadcastSidebarChanged(userId);
    return NextResponse.json(SessionPresenter.toResponse(result.session));
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      return errorResponse(error.message, 404, error.code);
    }
    if (error instanceof InvalidStateTransitionError) {
      return errorResponse(error.message, 400, error.code);
    }
    if (error instanceof RestartAgentError) {
      const status = error.code === "TMUX_SESSION_GONE" ? 410 : 400;
      return errorResponse(error.message, status, error.code);
    }
    throw error;
  }
});
