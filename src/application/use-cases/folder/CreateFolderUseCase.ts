/**
 * CreateFolderUseCase - Creates a new folder for organizing sessions.
 */

import { Folder } from "@/domain/entities/Folder";
import type { FolderRepository } from "@/application/ports/FolderRepository";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface CreateFolderInput {
  userId: string;
  name: string;
  parentId?: string | null;
}

export class CreateFolderUseCase {
  constructor(private readonly folderRepository: FolderRepository) {}

  async execute(input: CreateFolderInput): Promise<Folder> {
    // Validate parent folder exists if specified
    if (input.parentId) {
      const parentExists = await this.folderRepository.exists(
        input.parentId,
        input.userId
      );
      if (!parentExists) {
        throw new EntityNotFoundError("Parent folder", input.parentId);
      }
    }

    // Get next sort order
    const sortOrder = await this.folderRepository.getNextSortOrder(
      input.parentId ?? null,
      input.userId
    );

    // Create domain entity
    const folder = Folder.create({
      userId: input.userId,
      name: input.name,
      parentId: input.parentId ?? null,
      sortOrder,
    });

    // Persist
    return this.folderRepository.save(folder);
  }
}
