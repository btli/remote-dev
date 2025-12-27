import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { suspendSessionUseCase } from "@/infrastructure/container";
import { SessionPresenter } from "@/interface/presenters/SessionPresenter";
import { EntityNotFoundError, InvalidStateTransitionError } from "@/domain/errors/DomainError";

/**
 * POST /api/sessions/:id/suspend - Suspend a session (detach tmux)
 */
export const POST = withAuth(async (_request, { userId, params }) => {
  try {
    const session = await suspendSessionUseCase.execute({
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
    throw error;
  }
});
