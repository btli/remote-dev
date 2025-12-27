/**
 * MoveFolderUseCase - Moves a folder to a new parent.
 *
 * This use case handles folder hierarchy changes with proper validation:
 * - Validates that the target parent exists (if not null)
 * - Detects circular references to prevent broken hierarchies
 * - Updates sort order among new siblings
 */

import type { Folder } from "@/domain/entities/Folder";
import type { FolderRepository } from "@/application/ports/FolderRepository";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface MoveFolderInput {
  folderId: string;
  userId: string;
  newParentId: string | null;
}

export class MoveFolderUseCase {
  constructor(private readonly folderRepository: FolderRepository) {}

  async execute(input: MoveFolderInput): Promise<Folder> {
    // Fetch all folders for cycle detection
    const allFolders = await this.folderRepository.findByUser(input.userId);

    // Find the folder to move
    const folder = allFolders.find((f) => f.id === input.folderId);
    if (!folder) {
      throw new EntityNotFoundError("Folder", input.folderId);
    }

    // Validate new parent exists if specified
    if (input.newParentId !== null) {
      const parentExists = allFolders.some((f) => f.id === input.newParentId);
      if (!parentExists) {
        throw new EntityNotFoundError("Parent folder", input.newParentId);
      }
    }

    // Move folder (this validates for cycles internally)
    const moved = folder.moveTo(input.newParentId, allFolders);

    // Calculate new sort order among siblings
    const siblings = allFolders.filter(
      (f) => f.parentId === input.newParentId && f.id !== input.folderId
    );
    const maxOrder = siblings.reduce(
      (max, f) => Math.max(max, f.sortOrder),
      -1
    );
    const reordered = moved.setSortOrder(maxOrder + 1);

    // Persist and return
    return this.folderRepository.save(reordered);
  }
}
