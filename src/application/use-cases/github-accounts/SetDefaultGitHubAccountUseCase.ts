/**
 * SetDefaultGitHubAccountUseCase - Sets a GitHub account as the user's default.
 */

import { EntityNotFoundError } from "@/domain/errors/DomainError";
import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";

export interface SetDefaultGitHubAccountInput {
  userId: string;
  providerAccountId: string;
}

export class SetDefaultGitHubAccountUseCase {
  constructor(private readonly accountRepo: GitHubAccountRepository) {}

  async execute(input: SetDefaultGitHubAccountInput): Promise<void> {
    const account = await this.accountRepo.findByProviderAccountId(
      input.providerAccountId,
      input.userId
    );

    if (!account) {
      throw new EntityNotFoundError("GitHubAccount", input.providerAccountId);
    }

    await this.accountRepo.setDefault(input.providerAccountId, input.userId);
  }
}
