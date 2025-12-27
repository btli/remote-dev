/**
 * UpdateSessionUseCase - Updates session properties.
 *
 * Handles simple property updates like name, tabOrder, projectPath.
 * For state transitions (suspend, resume, close), use the specific use cases.
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface UpdateSessionInput {
  sessionId: string;
  userId: string;
  name?: string;
  tabOrder?: number;
  projectPath?: string;
}

export class UpdateSessionUseCase {
  constructor(private readonly sessionRepository: SessionRepository) {}

  async execute(input: UpdateSessionInput): Promise<Session> {
    const session = await this.sessionRepository.findById(
      input.sessionId,
      input.userId
    );

    if (!session) {
      throw new EntityNotFoundError("Session", input.sessionId);
    }

    let updated = session;

    if (input.name !== undefined) {
      updated = updated.rename(input.name);
    }

    if (input.tabOrder !== undefined) {
      updated = updated.setTabOrder(input.tabOrder);
    }

    // For projectPath, we need to add a method to Session entity
    // For now, we'll handle it through the repository
    if (input.projectPath !== undefined) {
      updated = updated.setProjectPath(input.projectPath);
    }

    return this.sessionRepository.save(updated);
  }
}
