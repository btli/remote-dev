/**
 * ResumeSessionUseCase - Resumes a suspended terminal session.
 *
 * Resuming reactivates a suspended session, making it ready for reconnection.
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface ResumeSessionInput {
  sessionId: string;
  userId: string;
}

export class ResumeSessionUseCase {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly tmuxGateway: TmuxGateway
  ) {}

  async execute(input: ResumeSessionInput): Promise<Session> {
    // Find the session
    const session = await this.sessionRepository.findById(
      input.sessionId,
      input.userId
    );

    if (!session) {
      throw new EntityNotFoundError("Session", input.sessionId);
    }

    // Verify tmux session still exists
    const tmuxExists = await this.tmuxGateway.sessionExists(
      session.tmuxSessionName.toString()
    );

    if (!tmuxExists) {
      throw new ResumeSessionError(
        "Tmux session no longer exists",
        "TMUX_SESSION_GONE"
      );
    }

    // Transition to active state (validates current state)
    const resumedSession = session.resume();

    // Persist state change
    return this.sessionRepository.save(resumedSession);
  }
}

export class ResumeSessionError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "ResumeSessionError";
  }
}
