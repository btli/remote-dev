/**
 * SuspendSessionUseCase - Suspends an active terminal session.
 *
 * Suspending detaches the tmux session but keeps it alive for later resume.
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";
import { EntityNotFoundError } from "@/domain/errors/DomainError";
import { createLogger } from "@/lib/logger";

const log = createLogger("SessionService");

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
    const saved = await this.sessionRepository.save(suspendedSession);

    // Audit trail for lifecycle transitions (smwq): one INFO line per suspend
    // so status debugging has a record. State changes are info-level.
    log.info("Session suspended", {
      sessionId: input.sessionId,
      name: saved.name,
      trigger: "SuspendSessionUseCase",
    });

    return saved;
  }
}
