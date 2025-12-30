/**
 * DrizzleGitHubIssueRepository - Drizzle ORM implementation of GitHubIssueRepository
 *
 * This repository handles all GitHub issue persistence operations using Drizzle ORM.
 * It converts between database records and GitHubIssue domain entities using GitHubIssueMapper.
 */

import { db } from "@/db";
import { githubIssues } from "@/db/schema";
import { eq, and, asc, desc, sql, min } from "drizzle-orm";
import type { GitHubIssue } from "@/domain/entities/GitHubIssue";
import type {
  GitHubIssueRepository,
  IssueFilters,
  IssueOrderBy,
} from "@/application/ports/GitHubIssueRepository";
import {
  GitHubIssueMapper,
  type GitHubIssueDbRecord,
} from "../mappers/GitHubIssueMapper";

export class DrizzleGitHubIssueRepository implements GitHubIssueRepository {
  /**
   * Find all issues for a repository with optional filters and ordering.
   */
  async findByRepositoryId(
    repositoryId: string,
    options?: {
      filters?: IssueFilters;
      orderBy?: IssueOrderBy;
      limit?: number;
      offset?: number;
    }
  ): Promise<GitHubIssue[]> {
    const conditions = [eq(githubIssues.repositoryId, repositoryId)];

    // Apply filters
    if (options?.filters) {
      const { state, isNew, hasMilestone } = options.filters;

      if (state) {
        conditions.push(eq(githubIssues.state, state));
      }

      if (isNew !== undefined) {
        conditions.push(eq(githubIssues.isNew, isNew));
      }

      if (hasMilestone !== undefined) {
        if (hasMilestone) {
          conditions.push(sql`${githubIssues.milestone} IS NOT NULL`);
        } else {
          conditions.push(sql`${githubIssues.milestone} IS NULL`);
        }
      }
    }

    // Build order clause
    const orderClause = this.buildOrderClause(options?.orderBy);

    const records = await db.query.githubIssues.findMany({
      where: and(...conditions),
      orderBy: orderClause,
      limit: options?.limit,
      offset: options?.offset,
    });

    return GitHubIssueMapper.toDomainMany(records as GitHubIssueDbRecord[]);
  }

  /**
   * Find a specific issue by repository ID and issue number.
   */
  async findByNumber(
    repositoryId: string,
    issueNumber: number
  ): Promise<GitHubIssue | null> {
    const record = await db.query.githubIssues.findFirst({
      where: and(
        eq(githubIssues.repositoryId, repositoryId),
        eq(githubIssues.issueNumber, issueNumber)
      ),
    });

    return record
      ? GitHubIssueMapper.toDomain(record as GitHubIssueDbRecord)
      : null;
  }

  /**
   * Find an issue by its database ID.
   */
  async findById(id: string): Promise<GitHubIssue | null> {
    const record = await db.query.githubIssues.findFirst({
      where: eq(githubIssues.id, id),
    });

    return record
      ? GitHubIssueMapper.toDomain(record as GitHubIssueDbRecord)
      : null;
  }

  /**
   * Count issues for a repository.
   */
  async count(repositoryId: string, filters?: IssueFilters): Promise<number> {
    const conditions = [eq(githubIssues.repositoryId, repositoryId)];

    if (filters?.state) {
      conditions.push(eq(githubIssues.state, filters.state));
    }
    if (filters?.isNew !== undefined) {
      conditions.push(eq(githubIssues.isNew, filters.isNew));
    }

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(githubIssues)
      .where(and(...conditions));

    return Number(result[0]?.count ?? 0);
  }

  /**
   * Count new (unseen) issues for a repository.
   */
  async countNew(repositoryId: string): Promise<number> {
    return this.count(repositoryId, { isNew: true });
  }

  /**
   * Save an issue (upsert by repository + issue number).
   */
  async save(issue: GitHubIssue): Promise<GitHubIssue> {
    const data = GitHubIssueMapper.toPersistence(issue);

    await db
      .insert(githubIssues)
      .values(data)
      .onConflictDoUpdate({
        target: [githubIssues.repositoryId, githubIssues.issueNumber],
        set: {
          title: data.title,
          state: data.state,
          body: data.body,
          htmlUrl: data.htmlUrl,
          author: data.author,
          labels: data.labels,
          assignees: data.assignees,
          milestone: data.milestone,
          comments: data.comments,
          isNew: data.isNew,
          updatedAt: data.updatedAt,
          cachedAt: data.cachedAt,
        },
      });

    return issue;
  }

  /**
   * Save multiple issues in a batch.
   */
  async saveMany(issues: GitHubIssue[]): Promise<void> {
    if (issues.length === 0) return;

    const values = issues.map((issue) => GitHubIssueMapper.toPersistence(issue));

    // SQLite doesn't support bulk upsert well, so we do it in a transaction
    await db.transaction(async (tx) => {
      for (const data of values) {
        await tx
          .insert(githubIssues)
          .values(data)
          .onConflictDoUpdate({
            target: [githubIssues.repositoryId, githubIssues.issueNumber],
            set: {
              title: data.title,
              state: data.state,
              body: data.body,
              htmlUrl: data.htmlUrl,
              author: data.author,
              labels: data.labels,
              assignees: data.assignees,
              milestone: data.milestone,
              comments: data.comments,
              isNew: data.isNew,
              updatedAt: data.updatedAt,
              cachedAt: data.cachedAt,
            },
          });
      }
    });
  }

  /**
   * Delete all issues for a repository.
   */
  async deleteByRepositoryId(repositoryId: string): Promise<number> {
    const result = await db
      .delete(githubIssues)
      .where(eq(githubIssues.repositoryId, repositoryId));

    return result.rowsAffected ?? 0;
  }

  /**
   * Delete stale issues (cached before a certain date).
   */
  async deleteStale(repositoryId: string, cachedBefore: Date): Promise<number> {
    const result = await db
      .delete(githubIssues)
      .where(
        and(
          eq(githubIssues.repositoryId, repositoryId),
          sql`${githubIssues.cachedAt} < ${cachedBefore.getTime()}`
        )
      );

    return result.rowsAffected ?? 0;
  }

  /**
   * Mark all issues in a repository as seen.
   */
  async markAllAsSeen(repositoryId: string): Promise<number> {
    const result = await db
      .update(githubIssues)
      .set({ isNew: false })
      .where(
        and(
          eq(githubIssues.repositoryId, repositoryId),
          eq(githubIssues.isNew, true)
        )
      );

    return result.rowsAffected ?? 0;
  }

  /**
   * Mark a specific issue as seen.
   */
  async markAsSeen(
    repositoryId: string,
    issueNumber: number
  ): Promise<boolean> {
    const result = await db
      .update(githubIssues)
      .set({ isNew: false })
      .where(
        and(
          eq(githubIssues.repositoryId, repositoryId),
          eq(githubIssues.issueNumber, issueNumber),
          eq(githubIssues.isNew, true)
        )
      );

    return (result.rowsAffected ?? 0) > 0;
  }

  /**
   * Check if any issues exist for a repository.
   */
  async exists(repositoryId: string): Promise<boolean> {
    const record = await db.query.githubIssues.findFirst({
      where: eq(githubIssues.repositoryId, repositoryId),
      columns: { id: true },
    });

    return record !== undefined;
  }

  /**
   * Get the cache age (oldest cachedAt) for a repository's issues.
   */
  async getCacheAge(repositoryId: string): Promise<Date | null> {
    const result = await db
      .select({ oldest: min(githubIssues.cachedAt) })
      .from(githubIssues)
      .where(eq(githubIssues.repositoryId, repositoryId));

    const oldest = result[0]?.oldest;
    return oldest ? new Date(oldest) : null;
  }

  /**
   * Check if the cache is expired for a repository.
   */
  async isCacheExpired(repositoryId: string, ttlMs: number): Promise<boolean> {
    const cacheAge = await this.getCacheAge(repositoryId);

    if (!cacheAge) {
      return true; // No cache exists
    }

    const expiresAt = cacheAge.getTime() + ttlMs;
    return Date.now() > expiresAt;
  }

  /**
   * Build order clause based on options.
   */
  private buildOrderClause(orderBy?: IssueOrderBy) {
    if (!orderBy) {
      return [desc(githubIssues.updatedAt)];
    }

    const column = {
      number: githubIssues.issueNumber,
      createdAt: githubIssues.createdAt,
      updatedAt: githubIssues.updatedAt,
      comments: githubIssues.comments,
    }[orderBy.field];

    return orderBy.direction === "asc" ? [asc(column)] : [desc(column)];
  }
}
