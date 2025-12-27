/**
 * SuspendSessionUseCase - Suspends an active terminal session.
 *
 * Suspending detaches the tmux session but keeps it alive for later resume.
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface SuspendSessionInput {
  sessionId: string;
  userId: string;
}

export class SuspendSessionUseCase {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly tmuxGateway: TmuxGateway
  ) {}

  async execute(input: SuspendSessionInput): Promise<Session> {
    // Find the session
    const session = await this.sessionRepository.findById(
      input.sessionId,
      input.userId
    );

    if (!session) {
      throw new EntityNotFoundError("Session", input.sessionId);
    }

    // Transition to suspended state (validates current state)
    const suspendedSession = session.suspend();

    // Detach tmux session
    await this.tmuxGateway.detachSession(session.tmuxSessionName.toString());

    // Persist state change
    return this.sessionRepository.save(suspendedSession);
  }
}
