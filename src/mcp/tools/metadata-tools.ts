/**
 * Metadata Tools - Project Metadata Enrichment and Retrieval
 *
 * Tools for detecting, storing, and querying project metadata.
 * These enable AI agents to understand project context for intelligent assistance.
 */
import { z } from "zod";
import { createTool } from "../registry";
import { successResult } from "../utils/error-handler";
import { DrizzleProjectMetadataRepository } from "@/infrastructure/persistence/repositories/DrizzleProjectMetadataRepository";
import { ProjectMetadataService } from "@/services/project-metadata-service";
import { EnrichProjectMetadataUseCase } from "@/application/use-cases/metadata/EnrichProjectMetadataUseCase";
import { GetProjectMetadataUseCase } from "@/application/use-cases/metadata/GetProjectMetadataUseCase";
import { ProjectMetadataMapper } from "@/infrastructure/persistence/mappers/ProjectMetadataMapper";
import type { RegisteredTool } from "../types";

// Create instances (could also be injected from container)
const repository = new DrizzleProjectMetadataRepository();
const detectionService = new ProjectMetadataService();
const enrichUseCase = new EnrichProjectMetadataUseCase(repository, detectionService);
const getUseCase = new GetProjectMetadataUseCase(repository, enrichUseCase);

/**
 * project_metadata_get - Get project metadata for a folder
 */
const projectMetadataGet = createTool({
  name: "project_metadata_get",
  description:
    "Get enriched project metadata for a folder. Returns detected tech stack, " +
    "dependencies, build tools, test frameworks, CI/CD config, and more. " +
    "Use autoEnrich=true to automatically detect metadata if missing/stale.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("The folder UUID to get metadata for"),
    projectPath: z
      .string()
      .optional()
      .describe("Project path (required if autoEnrich is true)"),
    autoEnrich: z
      .boolean()
      .optional()
      .default(false)
      .describe("Automatically enrich metadata if missing or stale"),
  }),
  handler: async (input, context) => {
    try {
      const result = await getUseCase.execute({
        userId: context.userId,
        folderId: input.folderId,
        projectPath: input.projectPath,
        autoEnrich: input.autoEnrich,
      });

      if (!result.metadata) {
        return successResult({
          success: false,
          error: "No metadata found for folder",
          code: "NOT_FOUND",
          hint: input.autoEnrich
            ? "Enrichment may have failed. Check projectPath is valid."
            : "Use autoEnrich=true with projectPath to detect metadata.",
        });
      }

      return successResult({
        success: true,
        metadata: ProjectMetadataMapper.toApiResponse(result.metadata),
        wasEnriched: result.wasEnriched,
        hint: result.metadata.hasData()
          ? `Detected ${result.metadata.framework ?? result.metadata.primaryLanguage ?? "unknown"} project.`
          : "Metadata pending enrichment.",
      });
    } catch (error) {
      return successResult({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        code: "GET_FAILED",
      });
    }
  },
});

/**
 * project_metadata_enrich - Enrich project metadata for a folder
 */
const projectMetadataEnrich = createTool({
  name: "project_metadata_enrich",
  description:
    "Detect and store project metadata for a folder. Analyzes the project directory " +
    "to identify languages, frameworks, dependencies, build tools, tests, CI/CD, and git state. " +
    "Use force=true to re-enrich even if metadata exists.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("The folder UUID to enrich metadata for"),
    projectPath: z.string().describe("Absolute path to the project directory"),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe("Force re-enrichment even if metadata is fresh"),
  }),
  handler: async (input, context) => {
    try {
      const result = await enrichUseCase.execute({
        userId: context.userId,
        folderId: input.folderId,
        projectPath: input.projectPath,
        force: input.force,
      });

      if (!result.success) {
        return successResult({
          success: false,
          error: result.error,
          code: "ENRICHMENT_FAILED",
          duration: result.duration,
        });
      }

      const metadata = result.metadata!;
      return successResult({
        success: true,
        metadata: {
          id: metadata.id,
          category: metadata.category,
          framework: metadata.framework,
          primaryLanguage: metadata.primaryLanguage,
          languages: metadata.languages,
          packageManager: metadata.packageManager,
          hasTypeScript: metadata.hasTypeScript,
          hasDocker: metadata.hasDocker,
          hasCI: metadata.hasCI,
          isMonorepo: metadata.isMonorepo,
          dependencyCount: metadata.dependencyCount,
          devDependencyCount: metadata.devDependencyCount,
          testFramework: metadata.testFramework?.framework ?? null,
          cicdProvider: metadata.cicd?.provider ?? null,
          gitBranch: metadata.git?.currentBranch ?? null,
          isDirty: metadata.git?.isDirty ?? null,
          suggestedStartupCommands: metadata.suggestedStartupCommands,
        },
        duration: result.duration,
        hint: `Detected ${metadata.framework ?? metadata.category} project with ${metadata.dependencyCount} deps.`,
      });
    } catch (error) {
      return successResult({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        code: "ENRICHMENT_ERROR",
      });
    }
  },
});

/**
 * project_metadata_detect - Detect project metadata without storing
 */
const projectMetadataDetect = createTool({
  name: "project_metadata_detect",
  description:
    "Detect project metadata for a directory WITHOUT storing it. " +
    "Use this for quick project analysis or before deciding whether to store. " +
    "For persistent metadata, use project_metadata_enrich instead.",
  inputSchema: z.object({
    projectPath: z.string().describe("Absolute path to the project directory to analyze"),
  }),
  handler: async (input) => {
    try {
      const result = await detectionService.detect(input.projectPath);

      return successResult({
        success: true,
        detection: {
          category: result.category,
          framework: result.framework,
          primaryLanguage: result.primaryLanguage,
          languages: result.languages,
          packageManager: result.packageManager,
          isMonorepo: result.isMonorepo,
          hasTypeScript: result.hasTypeScript,
          hasDocker: result.hasDocker,
          hasCI: result.hasCI,
          dependencyCount: result.dependencies.length,
          devDependencyCount: result.devDependencies.length,
          topDependencies: result.dependencies.slice(0, 10).map((d) => d.name),
          testFramework: result.testFramework?.framework ?? null,
          cicdProvider: result.cicd?.provider ?? null,
          gitInfo: result.git
            ? {
                currentBranch: result.git.currentBranch,
                defaultBranch: result.git.defaultBranch,
                isDirty: result.git.isDirty,
                commitCount: result.git.commitCount,
              }
            : null,
          fileStats: {
            total: result.totalFiles,
            source: result.sourceFiles,
            test: result.testFiles,
            config: result.configFiles,
          },
          suggestedStartupCommands: result.suggestedStartupCommands,
          suggestedAgentInstructions: result.suggestedAgentInstructions,
        },
        hint: `Detected ${result.framework ?? result.category} (${result.primaryLanguage ?? "unknown"}) project.`,
      });
    } catch (error) {
      return successResult({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        code: "DETECTION_FAILED",
        hint: "Check that projectPath exists and is accessible.",
      });
    }
  },
});

/**
 * project_metadata_list - List all project metadata for user
 */
const projectMetadataList = createTool({
  name: "project_metadata_list",
  description:
    "List all project metadata records for the current user. " +
    "Optionally filter by enrichment status to find stale or pending records.",
  inputSchema: z.object({
    status: z
      .enum(["pending", "enriching", "enriched", "stale", "failed"])
      .optional()
      .describe("Filter by enrichment status"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(50)
      .describe("Maximum number of records to return"),
  }),
  handler: async (input, context) => {
    try {
      const filters = input.status
        ? { enrichmentStatus: input.status as unknown as import("@/domain/value-objects/EnrichmentStatus").EnrichmentStatus }
        : undefined;

      const metadata = await repository.findByUser(context.userId, {
        filters,
        limit: input.limit,
        orderBy: { field: "updatedAt", direction: "desc" },
      });

      return successResult({
        success: true,
        count: metadata.length,
        items: metadata.map((m) => ({
          id: m.id,
          folderId: m.folderId,
          projectPath: m.projectPath,
          enrichmentStatus: m.enrichmentStatus.toString(),
          category: m.category,
          framework: m.framework,
          primaryLanguage: m.primaryLanguage,
          enrichedAt: m.enrichedAt?.toISOString() ?? null,
          isStale: m.isStaleByAge(),
        })),
        hint:
          metadata.length > 0
            ? `Found ${metadata.length} project metadata records.`
            : "No metadata records found. Use project_metadata_enrich to create one.",
      });
    } catch (error) {
      return successResult({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        code: "LIST_FAILED",
      });
    }
  },
});

/**
 * project_metadata_refresh_stale - Refresh all stale metadata
 */
const projectMetadataRefreshStale = createTool({
  name: "project_metadata_refresh_stale",
  description:
    "Find and refresh all stale project metadata records. " +
    "This is useful for batch updating metadata that has become outdated. " +
    "Returns the number of records refreshed.",
  inputSchema: z.object({
    maxRecords: z
      .number()
      .int()
      .positive()
      .optional()
      .default(10)
      .describe("Maximum number of records to refresh in one call"),
  }),
  handler: async (input, context) => {
    try {
      // Find stale records
      const staleRecords = await repository.findStale(context.userId);

      if (staleRecords.length === 0) {
        return successResult({
          success: true,
          refreshed: 0,
          message: "No stale metadata records found.",
        });
      }

      // Refresh up to maxRecords
      const toRefresh = staleRecords.slice(0, input.maxRecords);
      const results: Array<{ id: string; success: boolean; error?: string }> = [];

      for (const record of toRefresh) {
        const result = await enrichUseCase.execute({
          userId: context.userId,
          folderId: record.folderId,
          projectPath: record.projectPath,
          force: true,
        });

        results.push({
          id: record.id,
          success: result.success,
          error: result.error,
        });
      }

      const successCount = results.filter((r) => r.success).length;

      return successResult({
        success: true,
        refreshed: successCount,
        failed: results.length - successCount,
        totalStale: staleRecords.length,
        results,
        hint:
          successCount > 0
            ? `Refreshed ${successCount}/${results.length} stale records.`
            : "Failed to refresh any records. Check project paths.",
      });
    } catch (error) {
      return successResult({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        code: "REFRESH_FAILED",
      });
    }
  },
});

// Export all metadata tools
export const metadataTools: RegisteredTool[] = [
  projectMetadataGet,
  projectMetadataEnrich,
  projectMetadataDetect,
  projectMetadataList,
  projectMetadataRefreshStale,
];
