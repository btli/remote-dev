/**
 * LinkGitHubAccountUseCase - Orchestrates linking a GitHub account after OAuth.
 *
 * Handles:
 * 1. Conflict detection (account already linked to different user)
 * 2. Metadata persistence
 * 3. gh CLI config provisioning
 * 4. Default account promotion (first account = default)
 */

import { GitHubAccount } from "@/domain/entities/GitHubAccount";
import { GitHubAccountConflictError } from "@/domain/errors/DomainError";
import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";
import type { GhCliConfigGateway } from "@/application/ports/GhCliConfigGateway";

export interface LinkGitHubAccountInput {
  userId: string;
  providerAccountId: string;
  login: string;
  displayName: string | null;
  avatarUrl: string;
  email: string | null;
  /** Raw (decrypted) access token for gh CLI config */
  accessToken: string;
}

export interface LinkGitHubAccountOutput {
  account: GitHubAccount;
  isNewAccount: boolean;
  isDefault: boolean;
}

export class LinkGitHubAccountUseCase {
  constructor(
    private readonly accountRepo: GitHubAccountRepository,
    private readonly ghCliConfig: GhCliConfigGateway
  ) {}

  async execute(input: LinkGitHubAccountInput): Promise<LinkGitHubAccountOutput> {
    // Prevent linking an account already owned by a different user
    const existingOwner = await this.accountRepo.findOwner(input.providerAccountId);
    if (existingOwner && existingOwner !== input.userId) {
      throw new GitHubAccountConflictError(input.login, existingOwner);
    }

    const existing = await this.accountRepo.findByProviderAccountId(
      input.providerAccountId,
      input.userId
    );

    // First account for this user becomes the default
    const userAccounts = await this.accountRepo.findByUser(input.userId);
    const isDefault = existing?.isDefault ?? userAccounts.length === 0;

    const configDir = this.ghCliConfig.getConfigDir(input.providerAccountId);

    const account = existing
      ? existing.updateMetadata(input.login, input.displayName, input.avatarUrl, input.email)
      : GitHubAccount.create({
          providerAccountId: input.providerAccountId,
          userId: input.userId,
          login: input.login,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          email: input.email,
          isDefault,
          configDir,
        });

    await this.ghCliConfig.writeHostsConfig(configDir, input.accessToken, input.login);

    let saved: GitHubAccount;
    try {
      saved = await this.accountRepo.save(account);
    } catch (error) {
      // Compensating action: clean up config if DB save fails
      await this.ghCliConfig.removeConfig(configDir).catch(() => {});
      throw error;
    }

    if (isDefault && !existing?.isDefault) {
      await this.accountRepo.setDefault(input.providerAccountId, input.userId);
    }

    return { account: saved, isNewAccount: !existing, isDefault };
  }
}
