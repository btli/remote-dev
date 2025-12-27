/**
 * UpdateFolderUseCase - Updates folder properties (name, collapsed state, sortOrder).
 *
 * This use case handles simple property updates. For parent changes (moves),
 * use MoveFolderUseCase which includes cycle detection.
 */

import type { Folder } from "@/domain/entities/Folder";
import type { FolderRepository } from "@/application/ports/FolderRepository";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface UpdateFolderInput {
  folderId: string;
  userId: string;
  name?: string;
  collapsed?: boolean;
  sortOrder?: number;
}

export class UpdateFolderUseCase {
  constructor(private readonly folderRepository: FolderRepository) {}

  async execute(input: UpdateFolderInput): Promise<Folder> {
    // Find existing folder
    const folder = await this.folderRepository.findById(
      input.folderId,
      input.userId
    );

    if (!folder) {
      throw new EntityNotFoundError("Folder", input.folderId);
    }

    // Apply updates immutably
    let updated = folder;

    if (input.name !== undefined) {
      updated = updated.rename(input.name);
    }

    if (input.collapsed !== undefined) {
      updated = updated.setCollapsed(input.collapsed);
    }

    if (input.sortOrder !== undefined) {
      updated = updated.setSortOrder(input.sortOrder);
    }

    // Persist and return
    return this.folderRepository.save(updated);
  }
}
