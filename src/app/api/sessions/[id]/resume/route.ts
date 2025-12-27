import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { resumeSessionUseCase } from "@/infrastructure/container";
import { SessionPresenter } from "@/interface/presenters/SessionPresenter";
import { EntityNotFoundError, InvalidStateTransitionError } from "@/domain/errors/DomainError";
import { ResumeSessionError } from "@/application/use-cases/session/ResumeSessionUseCase";

/**
 * POST /api/sessions/:id/resume - Resume a suspended session
 */
export const POST = withAuth(async (_request, { userId, params }) => {
  try {
    const session = await resumeSessionUseCase.execute({
      sessionId: params!.id,
      userId,
    });
    return NextResponse.json(SessionPresenter.toResponse(session));
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      return errorResponse(error.message, 404, error.code);
    }
    if (error instanceof InvalidStateTransitionError) {
      return errorResponse(error.message, 400, error.code);
    }
    if (error instanceof ResumeSessionError) {
      const status = error.code === "TMUX_SESSION_GONE" ? 410 : 400;
      return errorResponse(error.message, status, error.code);
    }
    throw error;
  }
});
