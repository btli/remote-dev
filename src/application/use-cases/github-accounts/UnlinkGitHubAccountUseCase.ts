/**
 * UnlinkGitHubAccountUseCase - Disconnects a specific GitHub account.
 *
 * Handles:
 * 1. Removing gh CLI config
 * 2. Deleting metadata
 * 3. Optionally deleting the NextAuth account row
 * 4. Promoting another account to default if needed
 */

import { EntityNotFoundError } from "@/domain/errors/DomainError";
import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";
import type { GhCliConfigGateway } from "@/application/ports/GhCliConfigGateway";

export interface UnlinkGitHubAccountInput {
  userId: string;
  providerAccountId: string;
}

export class UnlinkGitHubAccountUseCase {
  constructor(
    private readonly accountRepo: GitHubAccountRepository,
    private readonly ghCliConfig: GhCliConfigGateway
  ) {}

  async execute(input: UnlinkGitHubAccountInput): Promise<void> {
    const account = await this.accountRepo.findByProviderAccountId(
      input.providerAccountId,
      input.userId
    );

    if (!account) {
      throw new EntityNotFoundError("GitHubAccount", input.providerAccountId);
    }

    await this.ghCliConfig.removeConfig(account.configDir).catch(() => {});
    await this.accountRepo.unbindProjectsByAccount(input.providerAccountId);
    await this.accountRepo.delete(input.providerAccountId, input.userId);

    // Promote another account to default if needed
    if (account.isDefault) {
      const remaining = await this.accountRepo.findByUser(input.userId);
      if (remaining.length > 0) {
        await this.accountRepo.setDefault(
          remaining[0].providerAccountId,
          input.userId
        );
      }
    }
  }
}
