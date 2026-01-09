/**
 * DrizzleProjectMetadataRepository - Drizzle ORM implementation of IProjectMetadataRepository
 *
 * This repository handles all project metadata persistence operations using Drizzle ORM.
 * It converts between database records and ProjectMetadata domain entities using ProjectMetadataMapper.
 */

import { db } from "@/db";
import { projectMetadata } from "@/db/schema";
import { eq, and, asc, desc, inArray, sql, lt, or } from "drizzle-orm";
import { ProjectMetadata } from "@/domain/entities/ProjectMetadata";
import { EnrichmentStatus } from "@/domain/value-objects/EnrichmentStatus";
import type {
  IProjectMetadataRepository,
  ProjectMetadataFilters,
  ProjectMetadataOrderBy,
} from "@/application/ports/IProjectMetadataRepository";
import { ProjectMetadataMapper, type ProjectMetadataDbRecord } from "../mappers/ProjectMetadataMapper";
import type {
  ProjectCategoryType,
  ProgrammingLanguageType,
} from "@/types/project-metadata";

// Default staleness threshold: 24 hours
const DEFAULT_STALENESS_MS = 24 * 60 * 60 * 1000;

export class DrizzleProjectMetadataRepository implements IProjectMetadataRepository {
  /**
   * Find project metadata by ID with user ownership check.
   */
  async findById(id: string, userId: string): Promise<ProjectMetadata | null> {
    const record = await db.query.projectMetadata.findFirst({
      where: and(
        eq(projectMetadata.id, id),
        eq(projectMetadata.userId, userId)
      ),
    });

    return record ? ProjectMetadataMapper.toDomain(record as ProjectMetadataDbRecord) : null;
  }

  /**
   * Find project metadata by folder ID.
   */
  async findByFolderId(folderId: string, userId: string): Promise<ProjectMetadata | null> {
    const record = await db.query.projectMetadata.findFirst({
      where: and(
        eq(projectMetadata.folderId, folderId),
        eq(projectMetadata.userId, userId)
      ),
    });

    return record ? ProjectMetadataMapper.toDomain(record as ProjectMetadataDbRecord) : null;
  }

  /**
   * Find project metadata by project path.
   */
  async findByProjectPath(projectPath: string, userId: string): Promise<ProjectMetadata | null> {
    const record = await db.query.projectMetadata.findFirst({
      where: and(
        eq(projectMetadata.projectPath, projectPath),
        eq(projectMetadata.userId, userId)
      ),
    });

    return record ? ProjectMetadataMapper.toDomain(record as ProjectMetadataDbRecord) : null;
  }

  /**
   * Find all project metadata for a user with optional filters and ordering.
   */
  async findByUser(
    userId: string,
    options?: {
      filters?: ProjectMetadataFilters;
      orderBy?: ProjectMetadataOrderBy;
      limit?: number;
      offset?: number;
    }
  ): Promise<ProjectMetadata[]> {
    const conditions = [eq(projectMetadata.userId, userId)];

    // Apply filters
    if (options?.filters) {
      const {
        enrichmentStatus,
        category,
        primaryLanguage,
        framework,
      } = options.filters;

      if (enrichmentStatus) {
        const statusValues = Array.isArray(enrichmentStatus) ? enrichmentStatus : [enrichmentStatus];
        conditions.push(
          inArray(
            projectMetadata.enrichmentStatus,
            statusValues.map((s) => s.toString())
          )
        );
      }

      if (category) {
        conditions.push(eq(projectMetadata.category, category as ProjectCategoryType));
      }

      if (primaryLanguage) {
        conditions.push(eq(projectMetadata.primaryLanguage, primaryLanguage as ProgrammingLanguageType));
      }

      if (framework) {
        conditions.push(eq(projectMetadata.framework, framework));
      }
    }

    // Build order clause
    const orderClause = this.buildOrderClause(options?.orderBy);

    const records = await db.query.projectMetadata.findMany({
      where: and(...conditions),
      orderBy: orderClause,
      limit: options?.limit,
      offset: options?.offset,
    });

    return ProjectMetadataMapper.toDomainMany(records as ProjectMetadataDbRecord[]);
  }

  /**
   * Find all stale metadata for a user.
   * Returns metadata where status is stale/pending/failed or enrichedAt is older than threshold.
   */
  async findStale(
    userId: string,
    thresholdMs: number = DEFAULT_STALENESS_MS
  ): Promise<ProjectMetadata[]> {
    const staleThresholdDate = new Date(Date.now() - thresholdMs);

    const records = await db.query.projectMetadata.findMany({
      where: and(
        eq(projectMetadata.userId, userId),
        or(
          // Status-based staleness
          inArray(projectMetadata.enrichmentStatus, ["stale", "pending", "failed"]),
          // Age-based staleness (enriched but older than threshold)
          and(
            eq(projectMetadata.enrichmentStatus, "enriched"),
            lt(projectMetadata.enrichedAt, staleThresholdDate)
          )
        )
      ),
    });

    return ProjectMetadataMapper.toDomainMany(records as ProjectMetadataDbRecord[]);
  }

  /**
   * Find metadata with specific enrichment status.
   */
  async findByEnrichmentStatus(
    userId: string,
    status: EnrichmentStatus | EnrichmentStatus[]
  ): Promise<ProjectMetadata[]> {
    const statusValues = Array.isArray(status) ? status : [status];

    const records = await db.query.projectMetadata.findMany({
      where: and(
        eq(projectMetadata.userId, userId),
        inArray(
          projectMetadata.enrichmentStatus,
          statusValues.map((s) => s.toString())
        )
      ),
    });

    return ProjectMetadataMapper.toDomainMany(records as ProjectMetadataDbRecord[]);
  }

  /**
   * Count metadata records for a user with optional filters.
   */
  async count(userId: string, filters?: ProjectMetadataFilters): Promise<number> {
    const conditions = [eq(projectMetadata.userId, userId)];

    if (filters) {
      const { enrichmentStatus, category, primaryLanguage, framework } = filters;

      if (enrichmentStatus) {
        const statusValues = Array.isArray(enrichmentStatus) ? enrichmentStatus : [enrichmentStatus];
        conditions.push(
          inArray(
            projectMetadata.enrichmentStatus,
            statusValues.map((s) => s.toString())
          )
        );
      }

      if (category) {
        conditions.push(eq(projectMetadata.category, category as ProjectCategoryType));
      }

      if (primaryLanguage) {
        conditions.push(eq(projectMetadata.primaryLanguage, primaryLanguage as ProgrammingLanguageType));
      }

      if (framework) {
        conditions.push(eq(projectMetadata.framework, framework));
      }
    }

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(projectMetadata)
      .where(and(...conditions));

    return result[0]?.count ?? 0;
  }

  /**
   * Find metadata by IDs (batch lookup).
   */
  async findByIds(ids: string[], userId: string): Promise<ProjectMetadata[]> {
    if (ids.length === 0) return [];

    const records = await db.query.projectMetadata.findMany({
      where: and(
        inArray(projectMetadata.id, ids),
        eq(projectMetadata.userId, userId)
      ),
    });

    return ProjectMetadataMapper.toDomainMany(records as ProjectMetadataDbRecord[]);
  }

  /**
   * Save project metadata (insert or update).
   * SECURITY: Always includes userId check to prevent cross-user data access.
   */
  async save(metadata: ProjectMetadata): Promise<ProjectMetadata> {
    const data = ProjectMetadataMapper.toPersistence(metadata);

    // Check if exists - SECURITY: must check both id AND userId
    const existing = await db.query.projectMetadata.findFirst({
      where: and(
        eq(projectMetadata.id, metadata.id),
        eq(projectMetadata.userId, metadata.userId)
      ),
      columns: { id: true },
    });

    if (existing) {
      // Update - SECURITY: must check both id AND userId
      const [updated] = await db
        .update(projectMetadata)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectMetadata.id, metadata.id),
            eq(projectMetadata.userId, metadata.userId)
          )
        )
        .returning();

      return ProjectMetadataMapper.toDomain(updated as ProjectMetadataDbRecord);
    } else {
      // Insert
      const [inserted] = await db
        .insert(projectMetadata)
        .values(data)
        .returning();

      return ProjectMetadataMapper.toDomain(inserted as ProjectMetadataDbRecord);
    }
  }

  /**
   * Save multiple metadata records in a batch (atomic).
   */
  async saveMany(metadataList: ProjectMetadata[]): Promise<void> {
    if (metadataList.length === 0) return;

    await db.transaction(async (tx) => {
      for (const metadata of metadataList) {
        const data = ProjectMetadataMapper.toPersistence(metadata);

        // SECURITY: must check both id AND userId
        const existing = await tx.query.projectMetadata.findFirst({
          where: and(
            eq(projectMetadata.id, metadata.id),
            eq(projectMetadata.userId, metadata.userId)
          ),
          columns: { id: true },
        });

        if (existing) {
          await tx
            .update(projectMetadata)
            .set({ ...data, updatedAt: new Date() })
            .where(
              and(
                eq(projectMetadata.id, metadata.id),
                eq(projectMetadata.userId, metadata.userId)
              )
            );
        } else {
          await tx.insert(projectMetadata).values(data);
        }
      }
    });
  }

  /**
   * Delete project metadata by ID.
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(projectMetadata)
      .where(
        and(eq(projectMetadata.id, id), eq(projectMetadata.userId, userId))
      );

    return result.rowsAffected > 0;
  }

  /**
   * Delete project metadata by folder ID.
   */
  async deleteByFolderId(folderId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(projectMetadata)
      .where(
        and(
          eq(projectMetadata.folderId, folderId),
          eq(projectMetadata.userId, userId)
        )
      );

    return result.rowsAffected > 0;
  }

  /**
   * Check if metadata exists for a folder.
   */
  async existsForFolder(folderId: string, userId: string): Promise<boolean> {
    const result = await db.query.projectMetadata.findFirst({
      where: and(
        eq(projectMetadata.folderId, folderId),
        eq(projectMetadata.userId, userId)
      ),
      columns: { id: true },
    });

    return result !== null && result !== undefined;
  }

  /**
   * Check if metadata exists.
   */
  async exists(id: string, userId: string): Promise<boolean> {
    const result = await db.query.projectMetadata.findFirst({
      where: and(
        eq(projectMetadata.id, id),
        eq(projectMetadata.userId, userId)
      ),
      columns: { id: true },
    });

    return result !== null && result !== undefined;
  }

  /**
   * Get or create metadata for a folder.
   * If metadata doesn't exist, creates a new pending record.
   */
  async getOrCreate(
    folderId: string,
    userId: string,
    projectPath: string
  ): Promise<ProjectMetadata> {
    // Try to find existing
    const existing = await this.findByFolderId(folderId, userId);
    if (existing) {
      return existing;
    }

    // Create new pending metadata
    const newMetadata = ProjectMetadata.create({
      folderId,
      userId,
      projectPath,
    });

    return this.save(newMetadata);
  }

  /**
   * Batch update enrichment status for multiple records.
   */
  async updateEnrichmentStatusBatch(
    ids: string[],
    userId: string,
    status: EnrichmentStatus
  ): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await db
      .update(projectMetadata)
      .set({
        enrichmentStatus: status.toString() as "pending" | "enriching" | "enriched" | "stale" | "failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(projectMetadata.id, ids),
          eq(projectMetadata.userId, userId)
        )
      );

    return result.rowsAffected;
  }

  /**
   * Build Drizzle order clause from ProjectMetadataOrderBy.
   */
  private buildOrderClause(orderBy?: ProjectMetadataOrderBy) {
    if (!orderBy) {
      return [desc(projectMetadata.updatedAt)];
    }

    const column = this.getOrderColumn(orderBy.field);
    return orderBy.direction === "desc" ? [desc(column)] : [asc(column)];
  }

  /**
   * Map order field name to Drizzle column.
   */
  private getOrderColumn(field: ProjectMetadataOrderBy["field"]) {
    switch (field) {
      case "createdAt":
        return projectMetadata.createdAt;
      case "updatedAt":
        return projectMetadata.updatedAt;
      case "enrichedAt":
        return projectMetadata.enrichedAt;
      case "projectPath":
        return projectMetadata.projectPath;
      default:
        return projectMetadata.updatedAt;
    }
  }
}
