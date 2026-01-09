/**
 * Project Metadata Type Definitions
 *
 * Types for enriched project metadata stored per folder/project.
 * This metadata enables intelligent orchestrator decisions and
 * contextual assistance.
 */
import { z } from "zod";

// ============================================================================
// Enum Types
// ============================================================================

/**
 * Enrichment Status
 * - pending: Record created, awaiting enrichment
 * - enriching: Detection/analysis in progress
 * - enriched: Successfully analyzed
 * - stale: Data exists but needs refresh
 * - failed: Enrichment attempt failed
 */
export type EnrichmentStatusType =
  | "pending"
  | "enriching"
  | "enriched"
  | "stale"
  | "failed";

export const EnrichmentStatusSchema = z.enum([
  "pending",
  "enriching",
  "enriched",
  "stale",
  "failed",
]);

/**
 * Project Category
 * High-level classification of project purpose
 */
export type ProjectCategoryType =
  | "web-frontend"
  | "web-backend"
  | "web-fullstack"
  | "cli"
  | "library"
  | "mobile"
  | "desktop"
  | "api"
  | "microservice"
  | "monorepo"
  | "infrastructure"
  | "data"
  | "unknown";

export const ProjectCategorySchema = z.enum([
  "web-frontend",
  "web-backend",
  "web-fullstack",
  "cli",
  "library",
  "mobile",
  "desktop",
  "api",
  "microservice",
  "monorepo",
  "infrastructure",
  "data",
  "unknown",
]);

/**
 * Programming Language
 */
export type ProgrammingLanguageType =
  | "javascript"
  | "typescript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "kotlin"
  | "swift"
  | "ruby"
  | "php"
  | "c"
  | "cpp"
  | "csharp"
  | "scala"
  | "elixir";

export const ProgrammingLanguageSchema = z.enum([
  "javascript",
  "typescript",
  "python",
  "rust",
  "go",
  "java",
  "kotlin",
  "swift",
  "ruby",
  "php",
  "c",
  "cpp",
  "csharp",
  "scala",
  "elixir",
]);

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Detected Dependency
 * A single dependency with version and usage context
 */
export interface DetectedDependency {
  name: string;
  version: string | null;
  isDev: boolean;
  source: "package.json" | "requirements.txt" | "pyproject.toml" | "Cargo.toml" | "go.mod" | "other";
}

export const DetectedDependencySchema = z.object({
  name: z.string(),
  version: z.string().nullable(),
  isDev: z.boolean(),
  source: z.enum([
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "other",
  ]),
});

/**
 * CI/CD Configuration
 * Detected CI/CD setup
 */
export interface CICDConfig {
  provider: "github-actions" | "gitlab-ci" | "circleci" | "jenkins" | "travis" | "other";
  hasTests: boolean;
  hasLinting: boolean;
  hasBuild: boolean;
  hasDeploy: boolean;
  workflows: string[];
}

export const CICDConfigSchema = z.object({
  provider: z.enum([
    "github-actions",
    "gitlab-ci",
    "circleci",
    "jenkins",
    "travis",
    "other",
  ]),
  hasTests: z.boolean(),
  hasLinting: z.boolean(),
  hasBuild: z.boolean(),
  hasDeploy: z.boolean(),
  workflows: z.array(z.string()),
});

/**
 * Test Framework Info
 * Detected testing configuration
 */
export interface TestFrameworkInfo {
  framework: string;
  configFile: string | null;
  hasUnitTests: boolean;
  hasIntegrationTests: boolean;
  hasE2ETests: boolean;
}

export const TestFrameworkInfoSchema = z.object({
  framework: z.string(),
  configFile: z.string().nullable(),
  hasUnitTests: z.boolean(),
  hasIntegrationTests: z.boolean(),
  hasE2ETests: z.boolean(),
});

/**
 * Build Tool Info
 * Detected build system configuration
 */
export interface BuildToolInfo {
  tool: string;
  configFile: string;
  scripts: Record<string, string>;
}

export const BuildToolInfoSchema = z.object({
  tool: z.string(),
  configFile: z.string(),
  scripts: z.record(z.string(), z.string()),
});

/**
 * Git Repository Info
 * Git-related metadata
 */
export interface GitRepoInfo {
  remoteUrl: string | null;
  defaultBranch: string;
  currentBranch: string;
  commitCount: number;
  lastCommitHash: string | null;
  lastCommitDate: Date | null;
  isDirty: boolean;
  untrackedCount: number;
  modifiedCount: number;
}

export const GitRepoInfoSchema = z.object({
  remoteUrl: z.string().nullable(),
  defaultBranch: z.string(),
  currentBranch: z.string(),
  commitCount: z.number(),
  lastCommitHash: z.string().nullable(),
  lastCommitDate: z.date().nullable(),
  isDirty: z.boolean(),
  untrackedCount: z.number(),
  modifiedCount: z.number(),
});

/**
 * Project Metadata
 * Full enriched metadata for a project/folder
 */
export interface ProjectMetadata {
  id: string;
  folderId: string;
  userId: string;
  projectPath: string;

  // Enrichment status
  enrichmentStatus: EnrichmentStatusType;
  enrichedAt: Date | null;
  lastEnrichmentError: string | null;

  // Project classification
  category: ProjectCategoryType;
  primaryLanguage: ProgrammingLanguageType | null;
  languages: ProgrammingLanguageType[];
  framework: string | null;

  // Project structure flags
  isMonorepo: boolean;
  hasTypeScript: boolean;
  hasDocker: boolean;
  hasCI: boolean;

  // Dependency information
  dependencies: DetectedDependency[];
  devDependencies: DetectedDependency[];
  dependencyCount: number;
  devDependencyCount: number;

  // Build/Test configuration
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "uv" | "cargo" | "go" | null;
  buildTool: BuildToolInfo | null;
  testFramework: TestFrameworkInfo | null;
  cicd: CICDConfig | null;

  // Git information
  git: GitRepoInfo | null;

  // File statistics
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  configFiles: number;

  // Agent hints (for orchestrator)
  suggestedStartupCommands: string[];
  suggestedAgentInstructions: string | null;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export const ProjectMetadataSchema = z.object({
  id: z.string().uuid(),
  folderId: z.string().uuid(),
  userId: z.string().uuid(),
  projectPath: z.string(),

  enrichmentStatus: EnrichmentStatusSchema,
  enrichedAt: z.date().nullable(),
  lastEnrichmentError: z.string().nullable(),

  category: ProjectCategorySchema,
  primaryLanguage: ProgrammingLanguageSchema.nullable(),
  languages: z.array(ProgrammingLanguageSchema),
  framework: z.string().nullable(),

  isMonorepo: z.boolean(),
  hasTypeScript: z.boolean(),
  hasDocker: z.boolean(),
  hasCI: z.boolean(),

  dependencies: z.array(DetectedDependencySchema),
  devDependencies: z.array(DetectedDependencySchema),
  dependencyCount: z.number(),
  devDependencyCount: z.number(),

  packageManager: z
    .enum(["npm", "yarn", "pnpm", "bun", "pip", "uv", "cargo", "go"])
    .nullable(),
  buildTool: BuildToolInfoSchema.nullable(),
  testFramework: TestFrameworkInfoSchema.nullable(),
  cicd: CICDConfigSchema.nullable(),

  git: GitRepoInfoSchema.nullable(),

  totalFiles: z.number(),
  sourceFiles: z.number(),
  testFiles: z.number(),
  configFiles: z.number(),

  suggestedStartupCommands: z.array(z.string()),
  suggestedAgentInstructions: z.string().nullable(),

  createdAt: z.date(),
  updatedAt: z.date(),
});

// ============================================================================
// Request/Response Interfaces
// ============================================================================

/**
 * Enrichment Request
 */
export interface EnrichProjectMetadataRequest {
  folderId: string;
  projectPath: string;
  force?: boolean; // Force re-enrichment even if not stale
}

export const EnrichProjectMetadataRequestSchema = z.object({
  folderId: z.string().uuid(),
  projectPath: z.string(),
  force: z.boolean().optional(),
});

/**
 * Enrichment Result
 */
export interface EnrichmentResult {
  success: boolean;
  metadata: ProjectMetadata | null;
  error?: string;
  duration: number; // ms
}

/**
 * Detection Result (intermediate)
 * Raw detection output before database persistence
 */
export interface DetectionResult {
  category: ProjectCategoryType;
  primaryLanguage: ProgrammingLanguageType | null;
  languages: ProgrammingLanguageType[];
  framework: string | null;
  isMonorepo: boolean;
  hasTypeScript: boolean;
  hasDocker: boolean;
  hasCI: boolean;
  dependencies: DetectedDependency[];
  devDependencies: DetectedDependency[];
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "uv" | "cargo" | "go" | null;
  buildTool: BuildToolInfo | null;
  testFramework: TestFrameworkInfo | null;
  cicd: CICDConfig | null;
  git: GitRepoInfo | null;
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  configFiles: number;
  suggestedStartupCommands: string[];
  suggestedAgentInstructions: string | null;
}

// ============================================================================
// Staleness Configuration
// ============================================================================

/**
 * Default staleness threshold (24 hours)
 */
export const DEFAULT_STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Check if metadata is stale
 */
export function isMetadataStale(
  enrichedAt: Date | null,
  thresholdMs: number = DEFAULT_STALENESS_THRESHOLD_MS
): boolean {
  if (!enrichedAt) return true;
  return Date.now() - enrichedAt.getTime() > thresholdMs;
}
