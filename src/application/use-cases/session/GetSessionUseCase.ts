/**
 * GetSessionUseCase - Retrieves a single session by ID.
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface GetSessionInput {
  sessionId: string;
  userId: string;
}

export class GetSessionUseCase {
  constructor(private readonly sessionRepository: SessionRepository) {}

  async execute(input: GetSessionInput): Promise<Session> {
    const session = await this.sessionRepository.findById(
      input.sessionId,
      input.userId
    );

    if (!session) {
      throw new EntityNotFoundError("Session", input.sessionId);
    }

    return session;
  }
}
