/**
 * GitHubAccountRepository - Port interface for GitHub account persistence.
 *
 * Repository methods return domain entities (GitHubAccount), not database records.
 */

import type { GitHubAccount } from "@/domain/entities/GitHubAccount";

export interface GitHubAccountRepository {
  findByProviderAccountId(providerAccountId: string, userId: string): Promise<GitHubAccount | null>;
  findByUser(userId: string): Promise<GitHubAccount[]>;
  findDefault(userId: string): Promise<GitHubAccount | null>;

  getAccessToken(providerAccountId: string, userId: string): Promise<string | null>;
  save(account: GitHubAccount): Promise<GitHubAccount>;

  /** Deletes metadata only -- does NOT delete the underlying NextAuth account row. */
  delete(providerAccountId: string, userId: string): Promise<boolean>;

  /** Atomically set one account as default and clear all others for the user. */
  setDefault(providerAccountId: string, userId: string): Promise<void>;

  /** Returns the userId that owns this account, or null. */
  findOwner(providerAccountId: string): Promise<string | null>;

  /** Returns a map of providerAccountId -> scope string from the OAuth accounts table. */
  getAccountScopes(userId: string): Promise<Map<string, string | null>>;
}
