/**
 * ProjectMetadataMapper - Maps between database records and ProjectMetadata domain entity.
 *
 * This mapper handles the conversion of:
 * - Database records (from Drizzle queries) → ProjectMetadata domain entities
 * - ProjectMetadata domain entities → Database record format (for inserts/updates)
 */

import { ProjectMetadata, type ProjectMetadataProps } from "@/domain/entities/ProjectMetadata";
import { EnrichmentStatus } from "@/domain/value-objects/EnrichmentStatus";
import { ProjectType } from "@/domain/value-objects/ProjectType";
import type {
  DetectedDependency,
  CICDConfig,
  TestFrameworkInfo,
  BuildToolInfo,
  GitRepoInfo,
  EnrichmentStatusType,
  ProjectCategoryType,
  ProgrammingLanguageType,
} from "@/types/project-metadata";

/**
 * Raw database record type from Drizzle query.
 * This matches the projectMetadata schema.
 */
export interface ProjectMetadataDbRecord {
  id: string;
  folderId: string;
  userId: string;
  projectPath: string;
  enrichmentStatus: string;
  enrichedAt: Date | string | null;
  lastEnrichmentError: string | null;
  category: string;
  primaryLanguage: string | null;
  languages: string; // JSON array
  framework: string | null;
  isMonorepo: boolean;
  hasTypeScript: boolean;
  hasDocker: boolean;
  hasCI: boolean;
  dependencies: string; // JSON array
  devDependencies: string; // JSON array
  dependencyCount: number;
  devDependencyCount: number;
  packageManager: string | null;
  buildTool: string | null; // JSON
  testFramework: string | null; // JSON
  cicd: string | null; // JSON
  git: string | null; // JSON
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  configFiles: number;
  suggestedStartupCommands: string; // JSON array
  suggestedAgentInstructions: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Format for database insert/update operations.
 */
export interface ProjectMetadataDbInsert {
  id: string;
  folderId: string;
  userId: string;
  projectPath: string;
  enrichmentStatus: EnrichmentStatusType;
  enrichedAt: Date | null;
  lastEnrichmentError: string | null;
  category: ProjectCategoryType;
  primaryLanguage: ProgrammingLanguageType | null;
  languages: string;
  framework: string | null;
  isMonorepo: boolean;
  hasTypeScript: boolean;
  hasDocker: boolean;
  hasCI: boolean;
  dependencies: string;
  devDependencies: string;
  dependencyCount: number;
  devDependencyCount: number;
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "uv" | "cargo" | "go" | null;
  buildTool: string | null;
  testFramework: string | null;
  cicd: string | null;
  git: string | null;
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  configFiles: number;
  suggestedStartupCommands: string;
  suggestedAgentInstructions: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectMetadataMapper {
  /**
   * Convert a database record to a ProjectMetadata domain entity.
   */
  static toDomain(record: ProjectMetadataDbRecord): ProjectMetadata {
    const languages = parseJsonArray<ProgrammingLanguageType>(record.languages);
    const dependencies = parseJsonArray<DetectedDependency>(record.dependencies);
    const devDependencies = parseJsonArray<DetectedDependency>(record.devDependencies);
    const suggestedStartupCommands = parseJsonArray<string>(record.suggestedStartupCommands);

    const projectType = ProjectType.create({
      category: record.category as ProjectCategoryType,
      primaryLanguage: record.primaryLanguage as ProgrammingLanguageType | null,
      languages,
      framework: record.framework,
      isMonorepo: record.isMonorepo,
      hasTypeScript: record.hasTypeScript,
      hasDocker: record.hasDocker,
      hasCI: record.hasCI,
    });

    const props: ProjectMetadataProps = {
      id: record.id,
      folderId: record.folderId,
      userId: record.userId,
      projectPath: record.projectPath,
      enrichmentStatus: EnrichmentStatus.fromString(record.enrichmentStatus),
      enrichedAt: record.enrichedAt ? toDate(record.enrichedAt) : null,
      lastEnrichmentError: record.lastEnrichmentError,
      projectType,
      dependencies,
      devDependencies,
      packageManager: record.packageManager as ProjectMetadataProps["packageManager"],
      buildTool: parseJsonOrNull<BuildToolInfo>(record.buildTool),
      testFramework: parseJsonOrNull<TestFrameworkInfo>(record.testFramework),
      cicd: parseJsonOrNull<CICDConfig>(record.cicd),
      git: parseJsonOrNull<GitRepoInfo>(record.git),
      totalFiles: record.totalFiles,
      sourceFiles: record.sourceFiles,
      testFiles: record.testFiles,
      configFiles: record.configFiles,
      suggestedStartupCommands,
      suggestedAgentInstructions: record.suggestedAgentInstructions,
      createdAt: toDate(record.createdAt),
      updatedAt: toDate(record.updatedAt),
    };

    return ProjectMetadata.reconstitute(props);
  }

  /**
   * Convert multiple database records to ProjectMetadata domain entities.
   */
  static toDomainMany(records: ProjectMetadataDbRecord[]): ProjectMetadata[] {
    return records.map((r) => ProjectMetadataMapper.toDomain(r));
  }

  /**
   * Convert a ProjectMetadata domain entity to database insert format.
   */
  static toPersistence(metadata: ProjectMetadata): ProjectMetadataDbInsert {
    const plain = metadata.toPlainObject();

    return {
      id: plain.id,
      folderId: plain.folderId,
      userId: plain.userId,
      projectPath: plain.projectPath,
      enrichmentStatus: plain.enrichmentStatus as EnrichmentStatusType,
      enrichedAt: plain.enrichedAt,
      lastEnrichmentError: plain.lastEnrichmentError,
      category: plain.category,
      primaryLanguage: plain.primaryLanguage,
      languages: JSON.stringify(plain.languages),
      framework: plain.framework,
      isMonorepo: plain.isMonorepo,
      hasTypeScript: plain.hasTypeScript,
      hasDocker: plain.hasDocker,
      hasCI: plain.hasCI,
      dependencies: JSON.stringify(plain.dependencies),
      devDependencies: JSON.stringify(plain.devDependencies),
      dependencyCount: plain.dependencies.length,
      devDependencyCount: plain.devDependencies.length,
      packageManager: plain.packageManager,
      buildTool: plain.buildTool ? JSON.stringify(plain.buildTool) : null,
      testFramework: plain.testFramework ? JSON.stringify(plain.testFramework) : null,
      cicd: plain.cicd ? JSON.stringify(plain.cicd) : null,
      git: plain.git ? JSON.stringify(plain.git) : null,
      totalFiles: plain.totalFiles,
      sourceFiles: plain.sourceFiles,
      testFiles: plain.testFiles,
      configFiles: plain.configFiles,
      suggestedStartupCommands: JSON.stringify(plain.suggestedStartupCommands),
      suggestedAgentInstructions: plain.suggestedAgentInstructions,
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };
  }

  /**
   * Convert a ProjectMetadata to the API response format.
   */
  static toApiResponse(metadata: ProjectMetadata) {
    const plain = metadata.toPlainObject();
    return {
      ...plain,
      // Convert git.lastCommitDate to ISO string for JSON serialization
      git: plain.git
        ? {
            ...plain.git,
            lastCommitDate: plain.git.lastCommitDate?.toISOString() ?? null,
          }
        : null,
    };
  }
}

/**
 * Helper to convert string or Date to Date.
 */
function toDate(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

/**
 * Helper to parse JSON array, returning empty array on failure.
 */
function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Helper to parse JSON or return null.
 */
function parseJsonOrNull<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
