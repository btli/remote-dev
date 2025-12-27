/**
 * ReorderFoldersUseCase - Updates sort order for multiple folders.
 *
 * This use case accepts an array of folder IDs in the desired order
 * and updates their sortOrder values accordingly.
 *
 * All folders must belong to the requesting user.
 */

import type { FolderRepository } from "@/application/ports/FolderRepository";
import { BusinessRuleViolationError } from "@/domain/errors/DomainError";

export interface ReorderFoldersInput {
  userId: string;
  folderIds: string[];
}

export class ReorderFoldersUseCase {
  constructor(private readonly folderRepository: FolderRepository) {}

  async execute(input: ReorderFoldersInput): Promise<void> {
    if (input.folderIds.length === 0) {
      return; // Nothing to reorder
    }

    // Validate all folders exist and belong to user
    const allFolders = await this.folderRepository.findByUser(input.userId);
    const folderMap = new Map(allFolders.map((f) => [f.id, f]));

    for (const folderId of input.folderIds) {
      if (!folderMap.has(folderId)) {
        throw new BusinessRuleViolationError(
          "Invalid folder in reorder list",
          `Folder ${folderId} not found or doesn't belong to user`
        );
      }
    }

    // Create sort order updates
    const orders = input.folderIds.map((id, index) => ({
      id,
      sortOrder: index,
    }));

    // Update atomically
    await this.folderRepository.updateSortOrders(orders, input.userId);
  }
}
