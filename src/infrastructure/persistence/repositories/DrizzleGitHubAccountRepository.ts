/**
 * DrizzleGitHubAccountRepository - Drizzle ORM implementation of GitHubAccountRepository.
 *
 * Handles persistence of GitHub account metadata and folder bindings.
 * Token access goes through the NextAuth `accounts` table with decryption.
 */

import { db } from "@/db";
import {
  githubAccountMetadata,
  folderGitHubAccountLinks,
  accounts,
  sessionFolders,
} from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
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

  async findByFolder(
    folderId: string,
    userId: string
  ): Promise<GitHubAccount | null> {
    const link = await db.query.folderGitHubAccountLinks.findFirst({
      where: eq(folderGitHubAccountLinks.folderId, folderId),
    });

    if (!link) return null;

    return this.findByProviderAccountId(link.providerAccountId, userId);
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

    return saved ? GitHubAccountMapper.toDomain(saved) : account;
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

  async bindFolder(
    folderId: string,
    providerAccountId: string
  ): Promise<void> {
    await db
      .insert(folderGitHubAccountLinks)
      .values({
        folderId,
        providerAccountId,
      })
      .onConflictDoUpdate({
        target: folderGitHubAccountLinks.folderId,
        set: {
          providerAccountId,
          createdAt: new Date(),
        },
      });
  }

  async unbindFolder(folderId: string): Promise<void> {
    await db
      .delete(folderGitHubAccountLinks)
      .where(eq(folderGitHubAccountLinks.folderId, folderId));
  }

  async findFolderBindings(userId: string): Promise<Map<string, string>> {
    const folders = await db.query.sessionFolders.findMany({
      where: eq(sessionFolders.userId, userId),
      columns: { id: true },
    });

    const folderIds = folders.map((f) => f.id);
    if (folderIds.length === 0) return new Map();

    const links = await db
      .select()
      .from(folderGitHubAccountLinks)
      .where(inArray(folderGitHubAccountLinks.folderId, folderIds));

    return new Map(links.map((link) => [link.folderId, link.providerAccountId]));
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
}
