/**
 * ListGitHubAccountsUseCase - Lists all GitHub accounts for a user.
 */

import type { GitHubAccount } from "@/domain/entities/GitHubAccount";
import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";

export interface ListGitHubAccountsOutput {
  accounts: GitHubAccount[];
  projectBindings: Map<string, string>;
}

export class ListGitHubAccountsUseCase {
  constructor(private readonly accountRepo: GitHubAccountRepository) {}

  async execute(userId: string): Promise<ListGitHubAccountsOutput> {
    const [accounts, projectBindings] = await Promise.all([
      this.accountRepo.findByUser(userId),
      this.accountRepo.findProjectBindings(userId),
    ]);

    return { accounts, projectBindings };
  }
}
