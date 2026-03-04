/**
 * GitHubAccountMapper - Maps between database records and GitHubAccount domain entities.
 */

import { GitHubAccount } from "@/domain/entities/GitHubAccount";
import { GitHubAccountId } from "@/domain/value-objects/GitHubAccountId";
import type { githubAccountMetadata } from "@/db/schema";

export type GitHubAccountDbRecord = typeof githubAccountMetadata.$inferSelect;

export class GitHubAccountMapper {
  /**
   * Convert a database record to a domain entity.
   */
  static toDomain(record: GitHubAccountDbRecord): GitHubAccount {
    return GitHubAccount.reconstitute({
      id: GitHubAccountId.create(record.providerAccountId),
      userId: record.userId,
      login: record.login,
      displayName: record.displayName,
      avatarUrl: record.avatarUrl,
      email: record.email,
      isDefault: record.isDefault,
      configDir: record.configDir,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    });
  }

  /**
   * Convert a domain entity to database insert values.
   */
  static toPersistence(entity: GitHubAccount): GitHubAccountDbRecord {
    return {
      providerAccountId: entity.providerAccountId,
      userId: entity.userId,
      login: entity.login,
      displayName: entity.displayName,
      avatarUrl: entity.avatarUrl,
      email: entity.email,
      isDefault: entity.isDefault,
      configDir: entity.configDir,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
