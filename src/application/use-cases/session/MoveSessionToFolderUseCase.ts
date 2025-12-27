/**
 * MoveSessionToFolderUseCase - Moves a session to a folder (or removes from folder).
 *
 * Validates that the target folder exists and belongs to the user.
 */

import type { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import type { FolderRepository } from "@/application/ports/FolderRepository";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface MoveSessionToFolderInput {
  sessionId: string;
  userId: string;
  folderId: string | null;
}

export class MoveSessionToFolderUseCase {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly folderRepository: FolderRepository
  ) {}

  async execute(input: MoveSessionToFolderInput): Promise<Session> {
    // Find the session
    const session = await this.sessionRepository.findById(
      input.sessionId,
      input.userId
    );

    if (!session) {
      throw new EntityNotFoundError("Session", input.sessionId);
    }

    // Validate folder exists if specified
    if (input.folderId !== null) {
      const folderExists = await this.folderRepository.exists(
        input.folderId,
        input.userId
      );

      if (!folderExists) {
        throw new EntityNotFoundError("Folder", input.folderId);
      }
    }

    // Move session to folder
    const moved = session.moveToFolder(input.folderId);

    return this.sessionRepository.save(moved);
  }
}
