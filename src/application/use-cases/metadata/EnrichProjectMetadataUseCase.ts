/**
 * EnrichProjectMetadataUseCase - Orchestrates project metadata enrichment.
 *
 * This use case handles:
 * 1. Creating or retrieving existing metadata record
 * 2. Running detection service
 * 3. Updating metadata with detection results
 * 4. Handling errors gracefully
 */

import { ProjectMetadata } from "@/domain/entities/ProjectMetadata";
import type { IProjectMetadataRepository } from "@/application/ports/IProjectMetadataRepository";
import { ProjectMetadataService } from "@/services/project-metadata-service";
import type { DetectionResult } from "@/types/project-metadata";

export interface EnrichProjectMetadataInput {
  userId: string;
  folderId: string;
  projectPath: string;
  force?: boolean; // Force re-enrichment even if not stale
}

/**
 * Domain-layer result for enrichment operations.
 * Uses the domain entity, not the DTO.
 */
export interface EnrichmentResult {
  success: boolean;
  metadata: ProjectMetadata | null;
  error?: string;
  duration: number; // ms
}

export class EnrichProjectMetadataUseCase {
  constructor(
    private readonly repository: IProjectMetadataRepository,
    private readonly detectionService: ProjectMetadataService
  ) {}

  async execute(input: EnrichProjectMetadataInput): Promise<EnrichmentResult> {
    const startTime = Date.now();

    try {
      // Get or create metadata record
      let metadata = await this.repository.getOrCreate(
        input.folderId,
        input.userId,
        input.projectPath
      );

      // Check if enrichment is needed
      if (!input.force && !metadata.needsRefresh() && !metadata.isStaleByAge()) {
        return {
          success: true,
          metadata,
          duration: Date.now() - startTime,
        };
      }

      // Check if already enriching (prevent concurrent enrichment)
      if (metadata.isEnriching()) {
        return {
          success: false,
          metadata,
          error: "Enrichment already in progress",
          duration: Date.now() - startTime,
        };
      }

      // Start enrichment
      metadata = metadata.startEnrichment();
      await this.repository.save(metadata);

      // Run detection
      let detectionResult: DetectionResult;
      try {
        detectionResult = await this.detectionService.detect(input.projectPath);
      } catch (error) {
        // Mark as failed
        const errorMessage = error instanceof Error ? error.message : "Unknown detection error";
        metadata = metadata.failEnrichment(errorMessage);
        await this.repository.save(metadata);

        return {
          success: false,
          metadata,
          error: errorMessage,
          duration: Date.now() - startTime,
        };
      }

      // Complete enrichment with results
      metadata = metadata.completeEnrichment(detectionResult);
      metadata = await this.repository.save(metadata);

      return {
        success: true,
        metadata,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        metadata: null,
        error: error instanceof Error ? error.message : "Unknown error",
        duration: Date.now() - startTime,
      };
    }
  }
}

export class EnrichProjectMetadataError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "EnrichProjectMetadataError";
  }
}
