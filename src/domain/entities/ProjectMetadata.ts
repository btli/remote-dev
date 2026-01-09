/**
 * ProjectMetadata - Domain entity representing enriched project information.
 *
 * This entity encapsulates project detection results and provides
 * intelligent accessors for orchestrator decisions.
 *
 * Invariants:
 * - A metadata record must be linked to a folder
 * - A metadata record must have a valid project path
 * - Enrichment status must follow state machine rules
 * - enrichedAt must be set when status is 'enriched'
 */

import { EnrichmentStatus } from "../value-objects/EnrichmentStatus";
import { ProjectType, type ProjectCategory, type ProgrammingLanguage } from "../value-objects/ProjectType";
import { InvalidValueError } from "../errors/DomainError";
import type {
  DetectedDependency,
  CICDConfig,
  TestFrameworkInfo,
  BuildToolInfo,
  GitRepoInfo,
  DetectionResult,
} from "@/types/project-metadata";

// Default staleness threshold: 24 hours
const DEFAULT_STALENESS_MS = 24 * 60 * 60 * 1000;

export interface ProjectMetadataProps {
  id: string;
  folderId: string;
  userId: string;
  projectPath: string;

  // Enrichment state
  enrichmentStatus: EnrichmentStatus;
  enrichedAt: Date | null;
  lastEnrichmentError: string | null;

  // Project classification (value object)
  projectType: ProjectType;

  // Dependency information
  dependencies: DetectedDependency[];
  devDependencies: DetectedDependency[];

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

  // Agent hints
  suggestedStartupCommands: string[];
  suggestedAgentInstructions: string | null;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectMetadataProps {
  id?: string;
  folderId: string;
  userId: string;
  projectPath: string;
}

export class ProjectMetadata {
  private constructor(private readonly props: ProjectMetadataProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError("ProjectMetadata.id", this.props.id, "Must be a non-empty string");
    }
    if (!this.props.folderId || typeof this.props.folderId !== "string") {
      throw new InvalidValueError("ProjectMetadata.folderId", this.props.folderId, "Must be a non-empty string");
    }
    if (!this.props.userId || typeof this.props.userId !== "string") {
      throw new InvalidValueError("ProjectMetadata.userId", this.props.userId, "Must be a non-empty string");
    }
    if (!this.props.projectPath || typeof this.props.projectPath !== "string") {
      throw new InvalidValueError("ProjectMetadata.projectPath", this.props.projectPath, "Must be a non-empty string");
    }
    // Invariant: enrichedAt must be set when status is 'enriched'
    if (this.props.enrichmentStatus.isEnriched() && !this.props.enrichedAt) {
      throw new InvalidValueError(
        "ProjectMetadata.enrichedAt",
        this.props.enrichedAt,
        "Must be set when status is 'enriched'"
      );
    }
  }

  /**
   * Create a new ProjectMetadata with pending enrichment status.
   */
  static create(props: CreateProjectMetadataProps): ProjectMetadata {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    return new ProjectMetadata({
      id,
      folderId: props.folderId,
      userId: props.userId,
      projectPath: props.projectPath,

      enrichmentStatus: EnrichmentStatus.pending(),
      enrichedAt: null,
      lastEnrichmentError: null,

      projectType: ProjectType.unknown(),

      dependencies: [],
      devDependencies: [],

      packageManager: null,
      buildTool: null,
      testFramework: null,
      cicd: null,

      git: null,

      totalFiles: 0,
      sourceFiles: 0,
      testFiles: 0,
      configFiles: 0,

      suggestedStartupCommands: [],
      suggestedAgentInstructions: null,

      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Reconstitute a ProjectMetadata from persisted data.
   * Used by repositories when loading from database.
   */
  static reconstitute(props: ProjectMetadataProps): ProjectMetadata {
    return new ProjectMetadata(props);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters (expose read-only access to properties)
  // ─────────────────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }

  get folderId(): string {
    return this.props.folderId;
  }

  get userId(): string {
    return this.props.userId;
  }

  get projectPath(): string {
    return this.props.projectPath;
  }

  get enrichmentStatus(): EnrichmentStatus {
    return this.props.enrichmentStatus;
  }

  get enrichedAt(): Date | null {
    return this.props.enrichedAt;
  }

  get lastEnrichmentError(): string | null {
    return this.props.lastEnrichmentError;
  }

  get projectType(): ProjectType {
    return this.props.projectType;
  }

  // Convenience accessors for project type
  get category(): ProjectCategory {
    return this.props.projectType.category;
  }

  get primaryLanguage(): ProgrammingLanguage | null {
    return this.props.projectType.primaryLanguage;
  }

  get languages(): ProgrammingLanguage[] {
    return this.props.projectType.languages;
  }

  get framework(): string | null {
    return this.props.projectType.framework;
  }

  get isMonorepo(): boolean {
    return this.props.projectType.isMonorepo;
  }

  get hasTypeScript(): boolean {
    return this.props.projectType.hasTypeScript;
  }

  get hasDocker(): boolean {
    return this.props.projectType.hasDocker;
  }

  get hasCI(): boolean {
    return this.props.projectType.hasCI;
  }

  get dependencies(): DetectedDependency[] {
    return [...this.props.dependencies];
  }

  get devDependencies(): DetectedDependency[] {
    return [...this.props.devDependencies];
  }

  get dependencyCount(): number {
    return this.props.dependencies.length;
  }

  get devDependencyCount(): number {
    return this.props.devDependencies.length;
  }

  get packageManager(): "npm" | "yarn" | "pnpm" | "bun" | "pip" | "uv" | "cargo" | "go" | null {
    return this.props.packageManager;
  }

  get buildTool(): BuildToolInfo | null {
    return this.props.buildTool;
  }

  get testFramework(): TestFrameworkInfo | null {
    return this.props.testFramework;
  }

  get cicd(): CICDConfig | null {
    return this.props.cicd;
  }

  get git(): GitRepoInfo | null {
    return this.props.git;
  }

  get totalFiles(): number {
    return this.props.totalFiles;
  }

  get sourceFiles(): number {
    return this.props.sourceFiles;
  }

  get testFiles(): number {
    return this.props.testFiles;
  }

  get configFiles(): number {
    return this.props.configFiles;
  }

  get suggestedStartupCommands(): string[] {
    return [...this.props.suggestedStartupCommands];
  }

  get suggestedAgentInstructions(): string | null {
    return this.props.suggestedAgentInstructions;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain Methods (state transitions and business logic)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Mark enrichment as started.
   * @throws InvalidStateTransitionError if transition not allowed
   */
  startEnrichment(): ProjectMetadata {
    this.props.enrichmentStatus.validateTransitionTo(
      EnrichmentStatus.enriching(),
      "startEnrichment"
    );
    return this.withUpdates({
      enrichmentStatus: EnrichmentStatus.enriching(),
      lastEnrichmentError: null,
    });
  }

  /**
   * Complete enrichment with detection results.
   * @throws InvalidStateTransitionError if not currently enriching
   */
  completeEnrichment(result: DetectionResult): ProjectMetadata {
    this.props.enrichmentStatus.validateTransitionTo(
      EnrichmentStatus.enriched(),
      "completeEnrichment"
    );

    const projectType = ProjectType.create({
      category: result.category,
      primaryLanguage: result.primaryLanguage,
      languages: result.languages,
      framework: result.framework,
      isMonorepo: result.isMonorepo,
      hasTypeScript: result.hasTypeScript,
      hasDocker: result.hasDocker,
      hasCI: result.hasCI,
    });

    return this.withUpdates({
      enrichmentStatus: EnrichmentStatus.enriched(),
      enrichedAt: new Date(),
      lastEnrichmentError: null,
      projectType,
      dependencies: result.dependencies,
      devDependencies: result.devDependencies,
      packageManager: result.packageManager,
      buildTool: result.buildTool,
      testFramework: result.testFramework,
      cicd: result.cicd,
      git: result.git,
      totalFiles: result.totalFiles,
      sourceFiles: result.sourceFiles,
      testFiles: result.testFiles,
      configFiles: result.configFiles,
      suggestedStartupCommands: result.suggestedStartupCommands,
      suggestedAgentInstructions: result.suggestedAgentInstructions,
    });
  }

  /**
   * Mark enrichment as failed.
   * @throws InvalidStateTransitionError if not currently enriching or pending
   */
  failEnrichment(error: string): ProjectMetadata {
    this.props.enrichmentStatus.validateTransitionTo(
      EnrichmentStatus.failed(),
      "failEnrichment"
    );
    return this.withUpdates({
      enrichmentStatus: EnrichmentStatus.failed(),
      lastEnrichmentError: error,
    });
  }

  /**
   * Mark metadata as stale (needs refresh).
   * Only valid from enriched state.
   */
  markStale(): ProjectMetadata {
    this.props.enrichmentStatus.validateTransitionTo(
      EnrichmentStatus.stale(),
      "markStale"
    );
    return this.withUpdates({
      enrichmentStatus: EnrichmentStatus.stale(),
    });
  }

  /**
   * Update project path.
   */
  setProjectPath(projectPath: string): ProjectMetadata {
    if (!projectPath || typeof projectPath !== "string" || !projectPath.trim()) {
      throw new InvalidValueError("projectPath", projectPath, "Must be a non-empty string");
    }
    // Changing project path should mark metadata as stale
    if (this.props.enrichmentStatus.hasData()) {
      return this.withUpdates({
        projectPath: projectPath.trim(),
        enrichmentStatus: EnrichmentStatus.stale(),
      });
    }
    return this.withUpdates({ projectPath: projectPath.trim() });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /** Check if enrichment is complete and data is available */
  hasData(): boolean {
    return this.props.enrichmentStatus.hasData();
  }

  /** Check if metadata needs refresh (stale, failed, or pending) */
  needsRefresh(): boolean {
    return this.props.enrichmentStatus.needsRefresh();
  }

  /** Check if enrichment is in progress */
  isEnriching(): boolean {
    return this.props.enrichmentStatus.isEnriching();
  }

  /**
   * Check if metadata is stale based on age.
   * @param thresholdMs Staleness threshold in milliseconds (default: 24 hours)
   */
  isStaleByAge(thresholdMs: number = DEFAULT_STALENESS_MS): boolean {
    if (!this.props.enrichedAt) return true;
    return Date.now() - this.props.enrichedAt.getTime() > thresholdMs;
  }

  /** Check if project is a web project */
  isWebProject(): boolean {
    return this.props.projectType.isWeb();
  }

  /** Check if project is a CLI tool */
  isCLIProject(): boolean {
    return this.props.projectType.isCLI();
  }

  /** Check if project uses a specific dependency */
  hasDependency(name: string): boolean {
    const normalizedName = name.toLowerCase();
    return (
      this.props.dependencies.some((d) => d.name.toLowerCase() === normalizedName) ||
      this.props.devDependencies.some((d) => d.name.toLowerCase() === normalizedName)
    );
  }

  /** Check if project has tests configured */
  hasTests(): boolean {
    return this.props.testFramework !== null;
  }

  /** Check if project has CI/CD configured */
  hasCICD(): boolean {
    return this.props.cicd !== null;
  }

  /** Check if project is a git repository */
  isGitRepo(): boolean {
    return this.props.git !== null;
  }

  /** Check if git working directory is dirty */
  isGitDirty(): boolean {
    return this.props.git?.isDirty ?? false;
  }

  /** Get a summary string for display */
  getSummary(): string {
    return this.props.projectType.describe();
  }

  /** Check if metadata belongs to specified user */
  belongsTo(userId: string): boolean {
    return this.props.userId === userId;
  }

  /**
   * Check equality (ignores timestamps).
   */
  equals(other: ProjectMetadata): boolean {
    return (
      this.id === other.id &&
      this.folderId === other.folderId &&
      this.userId === other.userId &&
      this.projectPath === other.projectPath &&
      this.props.enrichmentStatus.equals(other.props.enrichmentStatus) &&
      this.props.projectType.equals(other.props.projectType)
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new ProjectMetadata with updates applied.
   */
  private withUpdates(updates: Partial<ProjectMetadataProps>): ProjectMetadata {
    return new ProjectMetadata({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }

  /**
   * Convert to plain object for serialization.
   * Used by mappers when persisting to database.
   */
  toPlainObject(): {
    id: string;
    folderId: string;
    userId: string;
    projectPath: string;
    enrichmentStatus: string;
    enrichedAt: Date | null;
    lastEnrichmentError: string | null;
    category: ProjectCategory;
    primaryLanguage: ProgrammingLanguage | null;
    languages: ProgrammingLanguage[];
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
    createdAt: Date;
    updatedAt: Date;
  } {
    const projectTypeData = this.props.projectType.toJSON();
    return {
      id: this.props.id,
      folderId: this.props.folderId,
      userId: this.props.userId,
      projectPath: this.props.projectPath,
      enrichmentStatus: this.props.enrichmentStatus.toString(),
      enrichedAt: this.props.enrichedAt,
      lastEnrichmentError: this.props.lastEnrichmentError,
      category: projectTypeData.category,
      primaryLanguage: projectTypeData.primaryLanguage,
      languages: projectTypeData.languages,
      framework: projectTypeData.framework,
      isMonorepo: projectTypeData.isMonorepo,
      hasTypeScript: projectTypeData.hasTypeScript,
      hasDocker: projectTypeData.hasDocker,
      hasCI: projectTypeData.hasCI,
      dependencies: this.props.dependencies,
      devDependencies: this.props.devDependencies,
      packageManager: this.props.packageManager,
      buildTool: this.props.buildTool,
      testFramework: this.props.testFramework,
      cicd: this.props.cicd,
      git: this.props.git,
      totalFiles: this.props.totalFiles,
      sourceFiles: this.props.sourceFiles,
      testFiles: this.props.testFiles,
      configFiles: this.props.configFiles,
      suggestedStartupCommands: this.props.suggestedStartupCommands,
      suggestedAgentInstructions: this.props.suggestedAgentInstructions,
      createdAt: this.props.createdAt,
      updatedAt: this.props.updatedAt,
    };
  }
}
