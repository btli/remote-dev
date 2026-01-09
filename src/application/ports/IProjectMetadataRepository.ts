/**
 * IProjectMetadataRepository - Port interface for project metadata persistence.
 *
 * This interface defines the contract for project metadata data access.
 * Implementations can use any persistence mechanism (Drizzle, Prisma, in-memory, etc.)
 *
 * Repository methods return domain entities (ProjectMetadata), not database records.
 * The implementation is responsible for mapping between DB and domain types.
 */

import type { ProjectMetadata } from "@/domain/entities/ProjectMetadata";
import type { EnrichmentStatus } from "@/domain/value-objects/EnrichmentStatus";

export interface ProjectMetadataFilters {
  /** Filter by enrichment status */
  enrichmentStatus?: EnrichmentStatus | EnrichmentStatus[];
  /** Filter by project path (partial match) */
  projectPath?: string;
  /** Filter by category */
  category?: string;
  /** Filter by primary language */
  primaryLanguage?: string;
  /** Filter by framework */
  framework?: string;
  /** Filter by staleness (enrichedAt older than threshold) */
  staleThresholdMs?: number;
}

export interface ProjectMetadataOrderBy {
  field: "createdAt" | "updatedAt" | "enrichedAt" | "projectPath";
  direction: "asc" | "desc";
}

export interface IProjectMetadataRepository {
  /**
   * Find project metadata by ID.
   * Returns null if not found or doesn't belong to user.
   */
  findById(id: string, userId: string): Promise<ProjectMetadata | null>;

  /**
   * Find project metadata by folder ID.
   * Returns null if not found or doesn't belong to user.
   */
  findByFolderId(folderId: string, userId: string): Promise<ProjectMetadata | null>;

  /**
   * Find project metadata by project path.
   * Returns null if not found.
   */
  findByProjectPath(projectPath: string, userId: string): Promise<ProjectMetadata | null>;

  /**
   * Find all project metadata for a user.
   */
  findByUser(
    userId: string,
    options?: {
      filters?: ProjectMetadataFilters;
      orderBy?: ProjectMetadataOrderBy;
      limit?: number;
      offset?: number;
    }
  ): Promise<ProjectMetadata[]>;

  /**
   * Find all stale metadata for a user (needs refresh).
   * Returns metadata where status is stale/pending/failed or enrichedAt is older than threshold.
   */
  findStale(
    userId: string,
    thresholdMs?: number
  ): Promise<ProjectMetadata[]>;

  /**
   * Find metadata with specific enrichment status.
   */
  findByEnrichmentStatus(
    userId: string,
    status: EnrichmentStatus | EnrichmentStatus[]
  ): Promise<ProjectMetadata[]>;

  /**
   * Count metadata records for a user (with optional filters).
   */
  count(userId: string, filters?: ProjectMetadataFilters): Promise<number>;

  /**
   * Find metadata by IDs (batch lookup).
   */
  findByIds(ids: string[], userId: string): Promise<ProjectMetadata[]>;

  /**
   * Save project metadata (insert or update).
   * Returns the saved metadata (may have updated timestamps).
   */
  save(metadata: ProjectMetadata): Promise<ProjectMetadata>;

  /**
   * Save multiple metadata records in a batch.
   */
  saveMany(metadataList: ProjectMetadata[]): Promise<void>;

  /**
   * Delete project metadata by ID.
   * Returns true if deleted, false if not found.
   */
  delete(id: string, userId: string): Promise<boolean>;

  /**
   * Delete project metadata by folder ID.
   * Returns true if deleted, false if not found.
   */
  deleteByFolderId(folderId: string, userId: string): Promise<boolean>;

  /**
   * Check if metadata exists for a folder.
   */
  existsForFolder(folderId: string, userId: string): Promise<boolean>;

  /**
   * Check if metadata exists.
   */
  exists(id: string, userId: string): Promise<boolean>;

  /**
   * Get or create metadata for a folder.
   * If metadata doesn't exist, creates a new pending record.
   */
  getOrCreate(
    folderId: string,
    userId: string,
    projectPath: string
  ): Promise<ProjectMetadata>;

  /**
   * Batch update enrichment status for multiple records.
   * Useful for marking all stale metadata at once.
   */
  updateEnrichmentStatusBatch(
    ids: string[],
    userId: string,
    status: EnrichmentStatus
  ): Promise<number>;
}
