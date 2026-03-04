/**
 * ListGitHubAccountsUseCase - Lists all GitHub accounts for a user.
 */

import type { GitHubAccount } from "@/domain/entities/GitHubAccount";
import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";

export interface ListGitHubAccountsOutput {
  accounts: GitHubAccount[];
  folderBindings: Map<string, string>;
}

export class ListGitHubAccountsUseCase {
  constructor(private readonly accountRepo: GitHubAccountRepository) {}

  async execute(userId: string): Promise<ListGitHubAccountsOutput> {
    const [accounts, folderBindings] = await Promise.all([
      this.accountRepo.findByUser(userId),
      this.accountRepo.findFolderBindings(userId),
    ]);

    return { accounts, folderBindings };
  }
}
