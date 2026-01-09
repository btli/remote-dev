/**
 * GetProjectMetadataUseCase - Retrieve project metadata.
 *
 * This use case handles:
 * 1. Finding metadata by folder ID
 * 2. Optionally triggering enrichment if stale/missing
 */

import type { ProjectMetadata } from "@/domain/entities/ProjectMetadata";
import type { IProjectMetadataRepository } from "@/application/ports/IProjectMetadataRepository";
import { EnrichProjectMetadataUseCase } from "./EnrichProjectMetadataUseCase";

export interface GetProjectMetadataInput {
  userId: string;
  folderId: string;
  projectPath?: string; // Required if autoEnrich is true
  autoEnrich?: boolean; // Automatically enrich if missing/stale
}

export interface GetProjectMetadataOutput {
  metadata: ProjectMetadata | null;
  wasEnriched: boolean;
}

export class GetProjectMetadataUseCase {
  constructor(
    private readonly repository: IProjectMetadataRepository,
    private readonly enrichUseCase?: EnrichProjectMetadataUseCase
  ) {}

  async execute(input: GetProjectMetadataInput): Promise<GetProjectMetadataOutput> {
    // Try to find existing metadata
    const metadata = await this.repository.findByFolderId(input.folderId, input.userId);

    // If auto-enrich is enabled and we should refresh
    if (
      input.autoEnrich &&
      input.projectPath &&
      this.enrichUseCase &&
      (!metadata || metadata.needsRefresh() || metadata.isStaleByAge())
    ) {
      const result = await this.enrichUseCase.execute({
        userId: input.userId,
        folderId: input.folderId,
        projectPath: input.projectPath,
      });

      if (result.success && result.metadata) {
        return {
          metadata: result.metadata,
          wasEnriched: true,
        };
      }
    }

    return {
      metadata,
      wasEnriched: false,
    };
  }
}
