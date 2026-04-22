/**
 * BindProjectToGitHubAccountUseCase - Bind a project to a GitHub account.
 */

import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

export interface BindProjectToGitHubAccountInput {
  userId: string;
  projectId: string;
  providerAccountId: string;
}

export class BindProjectToGitHubAccountUseCase {
  constructor(private readonly accountRepo: GitHubAccountRepository) {}

  async execute(input: BindProjectToGitHubAccountInput): Promise<void> {
    const account = await this.accountRepo.findByProviderAccountId(
      input.providerAccountId,
      input.userId
    );
    if (!account) {
      throw new EntityNotFoundError("GitHubAccount", input.providerAccountId);
    }
    await this.accountRepo.bindProject(
      input.projectId,
      input.providerAccountId,
      input.userId
    );
  }
}
