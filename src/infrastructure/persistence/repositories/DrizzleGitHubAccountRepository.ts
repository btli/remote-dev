/**
 * DrizzleGitHubAccountRepository - Drizzle ORM implementation of GitHubAccountRepository.
 *
 * Handles persistence of GitHub account metadata and folder bindings.
 * Token access goes through the NextAuth `accounts` table with decryption.
 */

import { db } from "@/db";
import {
  githubAccountMetadata,
  accounts,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { decryptSafe } from "@/lib/encryption";
import type { GitHubAccount } from "@/domain/entities/GitHubAccount";
import type { GitHubAccountRepository } from "@/application/ports/GitHubAccountRepository";
import { GitHubAccountMapper } from "../mappers/GitHubAccountMapper";

export class DrizzleGitHubAccountRepository implements GitHubAccountRepository {
  async findByProviderAccountId(
    providerAccountId: string,
    userId: string
  ): Promise<GitHubAccount | null> {
    const record = await db.query.githubAccountMetadata.findFirst({
      where: and(
        eq(githubAccountMetadata.providerAccountId, providerAccountId),
        eq(githubAccountMetadata.userId, userId)
      ),
    });
    return record ? GitHubAccountMapper.toDomain(record) : null;
  }

  async findByUser(userId: string): Promise<GitHubAccount[]> {
    const records = await db.query.githubAccountMetadata.findMany({
      where: eq(githubAccountMetadata.userId, userId),
      orderBy: [
        desc(githubAccountMetadata.isDefault),
        desc(githubAccountMetadata.createdAt),
      ],
    });
    return records.map(GitHubAccountMapper.toDomain);
  }

  async findDefault(userId: string): Promise<GitHubAccount | null> {
    const record = await db.query.githubAccountMetadata.findFirst({
      where: and(
        eq(githubAccountMetadata.userId, userId),
        eq(githubAccountMetadata.isDefault, true)
      ),
    });
    if (record) return GitHubAccountMapper.toDomain(record);

    // Fallback: return the first account if no default is set
    const fallback = await db.query.githubAccountMetadata.findFirst({
      where: eq(githubAccountMetadata.userId, userId),
    });
    return fallback ? GitHubAccountMapper.toDomain(fallback) : null;
  }

  async getAccessToken(
    providerAccountId: string,
    userId: string
  ): Promise<string | null> {
    const account = await db.query.accounts.findFirst({
      where: and(
        eq(accounts.userId, userId),
        eq(accounts.provider, "github"),
        eq(accounts.providerAccountId, providerAccountId)
      ),
    });
    return decryptSafe(account?.access_token ?? null);
  }

  async save(account: GitHubAccount): Promise<GitHubAccount> {
    const data = GitHubAccountMapper.toPersistence(account);

    await db
      .insert(githubAccountMetadata)
      .values(data)
      .onConflictDoUpdate({
        target: githubAccountMetadata.providerAccountId,
        set: {
          login: data.login,
          displayName: data.displayName,
          avatarUrl: data.avatarUrl,
          email: data.email,
          isDefault: data.isDefault,
          configDir: data.configDir,
          updatedAt: new Date(),
        },
        // Guard against cross-user overwrite
        where: eq(githubAccountMetadata.userId, account.userId),
      });

    // Re-read to get the persisted version
    const saved = await db.query.githubAccountMetadata.findFirst({
      where: and(
        eq(githubAccountMetadata.providerAccountId, account.providerAccountId),
        eq(githubAccountMetadata.userId, account.userId)
      ),
    });

    if (!saved) {
      throw new Error(`Failed to save GitHubAccount: cross-user conflict for ${account.providerAccountId}`);
    }
    return GitHubAccountMapper.toDomain(saved);
  }

  async delete(providerAccountId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(githubAccountMetadata)
      .where(
        and(
          eq(githubAccountMetadata.providerAccountId, providerAccountId),
          eq(githubAccountMetadata.userId, userId)
        )
      );
    return (result.rowsAffected ?? 0) > 0;
  }

  async setDefault(providerAccountId: string, userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Clear all defaults for this user
      await tx
        .update(githubAccountMetadata)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(githubAccountMetadata.userId, userId));

      // Set the new default
      await tx
        .update(githubAccountMetadata)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(
          and(
            eq(githubAccountMetadata.providerAccountId, providerAccountId),
            eq(githubAccountMetadata.userId, userId)
          )
        );
    });
  }

  async findOwner(providerAccountId: string): Promise<string | null> {
    const record = await db.query.githubAccountMetadata.findFirst({
      where: eq(
        githubAccountMetadata.providerAccountId,
        providerAccountId
      ),
    });
    return record?.userId ?? null;
  }

  async getAccountScopes(userId: string): Promise<Map<string, string | null>> {
    const rows = await db
      .select({
        providerAccountId: accounts.providerAccountId,
        scope: accounts.scope,
      })
      .from(accounts)
      .where(
        and(eq(accounts.userId, userId), eq(accounts.provider, "github"))
      );

    return new Map(rows.map((r) => [r.providerAccountId, r.scope]));
  }
}
