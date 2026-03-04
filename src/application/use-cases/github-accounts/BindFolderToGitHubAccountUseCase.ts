/**
 * BindFolderToGitHubAccountUseCase - Binds a folder to a specific GitHub account.
 *
 * All sessions created in this folder will auto-inject the bound account's
 * GH_TOKEN and GH_CONFIG_DIR environment variables.
 */

import { EntityNotFoundError } from "@/domain/errors/DomainError";
import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";
import type { FolderRepository } from "@/application/ports/FolderRepository";

export interface BindFolderInput {
  userId: string;
  folderId: string;
  providerAccountId: string;
}

export class BindFolderToGitHubAccountUseCase {
  constructor(
    private readonly accountRepo: GitHubAccountRepository,
    private readonly folderRepo: FolderRepository
  ) {}

  async execute(input: BindFolderInput): Promise<void> {
    const folder = await this.folderRepo.findById(input.folderId, input.userId);
    if (!folder) throw new EntityNotFoundError("Folder", input.folderId);

    const account = await this.accountRepo.findByProviderAccountId(input.providerAccountId, input.userId);
    if (!account) throw new EntityNotFoundError("GitHubAccount", input.providerAccountId);

    await this.accountRepo.bindFolder(input.folderId, input.providerAccountId);
  }
}
