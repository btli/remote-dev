/**
 * DeleteFolderUseCase - Deletes a folder and orphans its sessions.
 *
 * When a folder is deleted:
 * - Sessions in the folder have their folderId set to null (moved to root)
 * - The folder itself is deleted
 *
 * Note: This does not cascade delete child folders. The caller should
 * handle child folders explicitly if needed.
 */

import type { FolderRepository } from "@/application/ports/FolderRepository";
import type { SessionRepository } from "@/application/ports/SessionRepository";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface DeleteFolderInput {
  folderId: string;
  userId: string;
}

export interface DeleteFolderResult {
  success: boolean;
  orphanedSessionCount: number;
}

export class DeleteFolderUseCase {
  constructor(
    private readonly folderRepository: FolderRepository,
    private readonly sessionRepository: SessionRepository
  ) {}

  async execute(input: DeleteFolderInput): Promise<DeleteFolderResult> {
    // Verify folder exists
    const folder = await this.folderRepository.findById(
      input.folderId,
      input.userId
    );

    if (!folder) {
      throw new EntityNotFoundError("Folder", input.folderId);
    }

    // Find sessions in this folder and orphan them
    const sessions = await this.sessionRepository.findByFolder(
      input.folderId,
      input.userId
    );

    // Remove folder from sessions
    for (const session of sessions) {
      const orphaned = session.removeFromFolder();
      await this.sessionRepository.save(orphaned);
    }

    // Delete the folder
    const deleted = await this.folderRepository.delete(
      input.folderId,
      input.userId
    );

    if (!deleted) {
      throw new EntityNotFoundError("Folder", input.folderId);
    }

    return {
      success: true,
      orphanedSessionCount: sessions.length,
    };
  }
}
