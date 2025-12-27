/**
 * CloseSessionUseCase - Closes a terminal session permanently.
 *
 * Closing terminates the tmux session and marks the session as closed.
 * Note: Worktree cleanup is handled separately by the caller, as it requires
 * context about the main repository path that isn't available at this layer.
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface CloseSessionInput {
  sessionId: string;
  userId: string;
}

export class CloseSessionUseCase {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly tmuxGateway: TmuxGateway
  ) {}

  async execute(input: CloseSessionInput): Promise<Session> {
    // Find the session
    const session = await this.sessionRepository.findById(
      input.sessionId,
      input.userId
    );

    if (!session) {
      throw new EntityNotFoundError("Session", input.sessionId);
    }

    // Kill tmux session (ignore errors - it might already be gone)
    await this.tmuxGateway
      .killSession(session.tmuxSessionName.toString())
      .catch((error) => {
        console.warn(`Tmux session already gone: ${error.message}`);
      });

    // Transition to closed state (validates current state)
    const closedSession = session.close();

    // Persist state change
    return this.sessionRepository.save(closedSession);
  }
}
