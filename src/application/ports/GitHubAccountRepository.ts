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

  /**
   * Returns a map of projectId -> providerAccountId for per-project GitHub account bindings.
   * Only projects owned by `userId` are considered.
   */
  findProjectBindings(userId: string): Promise<Map<string, string>>;

  /** Bind a project to a GitHub account (upsert). */
  bindProject(
    projectId: string,
    providerAccountId: string,
    userId: string
  ): Promise<void>;

  /** Remove a project's GitHub account binding. */
  unbindProject(projectId: string, userId: string): Promise<void>;

  /** Remove all project bindings for a given provider account (called on unlink). */
  unbindProjectsByAccount(providerAccountId: string): Promise<void>;

  /** Find the bound providerAccountId for a given project, if any. */
  findByProject(projectId: string): Promise<GitHubAccount | null>;
}
