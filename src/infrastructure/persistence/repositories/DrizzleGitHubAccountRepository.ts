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
  projectGitHubAccountLinks,
  projects,
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

  async findProjectBindings(userId: string): Promise<Map<string, string>> {
    const rows = await db
      .select({
        projectId: projectGitHubAccountLinks.projectId,
        providerAccountId: projectGitHubAccountLinks.providerAccountId,
      })
      .from(projectGitHubAccountLinks)
      .innerJoin(projects, eq(projects.id, projectGitHubAccountLinks.projectId))
      .where(eq(projects.userId, userId));

    return new Map(rows.map((r) => [r.projectId, r.providerAccountId]));
  }

  async bindProject(
    projectId: string,
    providerAccountId: string,
    userId: string
  ): Promise<void> {
    // Ensure the project belongs to the user before writing.
    const owned = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
      columns: { id: true },
    });
    if (!owned) return;

    await db
      .insert(projectGitHubAccountLinks)
      .values({ projectId, providerAccountId })
      .onConflictDoUpdate({
        target: projectGitHubAccountLinks.projectId,
        set: { providerAccountId },
      });
  }

  async unbindProject(projectId: string, userId: string): Promise<void> {
    const owned = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
      columns: { id: true },
    });
    if (!owned) return;

    await db
      .delete(projectGitHubAccountLinks)
      .where(eq(projectGitHubAccountLinks.projectId, projectId));
  }

  async unbindProjectsByAccount(providerAccountId: string): Promise<void> {
    await db
      .delete(projectGitHubAccountLinks)
      .where(eq(projectGitHubAccountLinks.providerAccountId, providerAccountId));
  }

  async findByProject(projectId: string): Promise<GitHubAccount | null> {
    const link = await db.query.projectGitHubAccountLinks.findFirst({
      where: eq(projectGitHubAccountLinks.projectId, projectId),
      columns: { providerAccountId: true },
    });
    if (!link) return null;

    const record = await db.query.githubAccountMetadata.findFirst({
      where: eq(githubAccountMetadata.providerAccountId, link.providerAccountId),
    });
    return record ? GitHubAccountMapper.toDomain(record) : null;
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
