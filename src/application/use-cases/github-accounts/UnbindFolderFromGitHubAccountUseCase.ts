/**
 * UnbindFolderFromGitHubAccountUseCase - Removes GitHub account binding from a folder.
 */

import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";
import type { FolderRepository } from "@/application/ports/FolderRepository";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface UnbindFolderInput {
  folderId: string;
  userId: string;
}

export class UnbindFolderFromGitHubAccountUseCase {
  constructor(
    private readonly accountRepo: GitHubAccountRepository,
    private readonly folderRepo: FolderRepository,
  ) {}

  async execute(input: UnbindFolderInput): Promise<void> {
    const folder = await this.folderRepo.findById(input.folderId, input.userId);
    if (!folder) throw new EntityNotFoundError("Folder", input.folderId);

    await this.accountRepo.unbindFolder(input.folderId);
  }
}
