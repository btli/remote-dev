/**
 * Skill - Domain entity for executable skills.
 *
 * Inspired by Voyager's ever-growing skill library.
 * Skills are verified, executable code (not just patterns).
 *
 * Key properties:
 * - Executable implementation (bash, typescript, mcp_tool, composite)
 * - Input/output schemas for type safety
 * - Verification with test cases
 * - Composition (skills can call other skills)
 * - Metrics (usage, success rate, duration)
 */

import { InvalidValueError } from "../errors/DomainError";

export type SkillImplementationType = "bash" | "typescript" | "mcp_tool" | "composite";
export type SkillCreator = "human" | "orchestrator";
export type SkillScope = "global" | "project";

export interface SkillImplementation {
  type: SkillImplementationType;
  code: string;
  entrypoint?: string; // For TS: function name
  dependencies?: string[]; // npm packages or other skill IDs
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

export interface TestCase {
  id: string;
  name: string;
  input: Record<string, unknown>;
  expected: {
    success: boolean;
    output?: unknown;
    error?: string;
  };
}

export interface SkillVerification {
  testCases: TestCase[];
  successCriteria: string;
  lastVerifiedAt: Date | null;
  verificationScore: number; // 0-1
}

export interface SkillMetrics {
  usageCount: number;
  successCount: number;
  failureCount: number;
  avgDuration: number; // milliseconds
  lastUsedAt: Date | null;
}

export interface SkillProps {
  id: string;
  name: string;
  description: string;
  implementation: SkillImplementation;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  verification: SkillVerification;
  triggers: string[]; // NL patterns that invoke this skill
  composedFrom: string[]; // Skill IDs this builds on
  metrics: SkillMetrics;
  scope: SkillScope;
  projectPath: string | null; // For project-scoped skills
  createdBy: SkillCreator;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSkillProps {
  id?: string;
  name: string;
  description: string;
  implementation: SkillImplementation;
  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;
  triggers?: string[];
  testCases?: TestCase[];
  successCriteria?: string;
  composedFrom?: string[];
  scope?: SkillScope;
  projectPath?: string;
  createdBy?: SkillCreator;
}

/**
 * Skill domain entity.
 */
export class Skill {
  private constructor(private readonly props: SkillProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError("Skill.id", this.props.id, "Must be a non-empty string");
    }
    if (!this.props.name || typeof this.props.name !== "string") {
      throw new InvalidValueError("Skill.name", this.props.name, "Must be a non-empty string");
    }
    if (!this.props.implementation?.code) {
      throw new InvalidValueError(
        "Skill.implementation.code",
        this.props.implementation?.code,
        "Must have executable code"
      );
    }
    if (this.props.scope === "project" && !this.props.projectPath) {
      throw new InvalidValueError(
        "Skill.projectPath",
        this.props.projectPath,
        "Project-scoped skills must have projectPath"
      );
    }
  }

  /**
   * Create a new skill.
   */
  static create(props: CreateSkillProps): Skill {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    return new Skill({
      id,
      name: props.name,
      description: props.description,
      implementation: props.implementation,
      inputSchema: props.inputSchema ?? { type: "object", properties: {} },
      outputSchema: props.outputSchema ?? { type: "object", properties: {} },
      verification: {
        testCases: props.testCases ?? [],
        successCriteria: props.successCriteria ?? "Skill executes without error",
        lastVerifiedAt: null,
        verificationScore: 0,
      },
      triggers: props.triggers ?? [],
      composedFrom: props.composedFrom ?? [],
      metrics: {
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        avgDuration: 0,
        lastUsedAt: null,
      },
      scope: props.scope ?? "project",
      projectPath: props.projectPath ?? null,
      createdBy: props.createdBy ?? "human",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Reconstitute from persisted data.
   */
  static reconstitute(props: SkillProps): Skill {
    return new Skill(props);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string {
    return this.props.description;
  }

  get implementation(): SkillImplementation {
    return { ...this.props.implementation };
  }

  get inputSchema(): JSONSchema {
    return { ...this.props.inputSchema };
  }

  get outputSchema(): JSONSchema {
    return { ...this.props.outputSchema };
  }

  get verification(): SkillVerification {
    return { ...this.props.verification };
  }

  get triggers(): string[] {
    return [...this.props.triggers];
  }

  get composedFrom(): string[] {
    return [...this.props.composedFrom];
  }

  get metrics(): SkillMetrics {
    return { ...this.props.metrics };
  }

  get scope(): SkillScope {
    return this.props.scope;
  }

  get projectPath(): string | null {
    return this.props.projectPath;
  }

  get createdBy(): SkillCreator {
    return this.props.createdBy;
  }

  get enabled(): boolean {
    return this.props.enabled;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed Properties
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get success rate (0-1).
   */
  get successRate(): number {
    const total = this.props.metrics.usageCount;
    if (total === 0) return 0;
    return this.props.metrics.successCount / total;
  }

  /**
   * Check if skill is verified.
   */
  get isVerified(): boolean {
    return this.props.verification.verificationScore >= 0.8;
  }

  /**
   * Check if skill is a composite (calls other skills).
   */
  get isComposite(): boolean {
    return this.props.implementation.type === "composite";
  }

  /**
   * Check if skill is global.
   */
  get isGlobal(): boolean {
    return this.props.scope === "global";
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // State Transitions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Record a successful execution.
   */
  recordSuccess(duration: number): Skill {
    const metrics = this.props.metrics;
    const newUsageCount = metrics.usageCount + 1;
    const newSuccessCount = metrics.successCount + 1;
    const newAvgDuration =
      (metrics.avgDuration * metrics.usageCount + duration) / newUsageCount;

    return this.withUpdates({
      metrics: {
        ...metrics,
        usageCount: newUsageCount,
        successCount: newSuccessCount,
        avgDuration: newAvgDuration,
        lastUsedAt: new Date(),
      },
    });
  }

  /**
   * Record a failed execution.
   */
  recordFailure(duration: number): Skill {
    const metrics = this.props.metrics;
    const newUsageCount = metrics.usageCount + 1;
    const newFailureCount = metrics.failureCount + 1;
    const newAvgDuration =
      (metrics.avgDuration * metrics.usageCount + duration) / newUsageCount;

    return this.withUpdates({
      metrics: {
        ...metrics,
        usageCount: newUsageCount,
        failureCount: newFailureCount,
        avgDuration: newAvgDuration,
        lastUsedAt: new Date(),
      },
    });
  }

  /**
   * Update verification status.
   */
  updateVerification(score: number, testCases?: TestCase[]): Skill {
    return this.withUpdates({
      verification: {
        ...this.props.verification,
        verificationScore: Math.max(0, Math.min(1, score)),
        lastVerifiedAt: new Date(),
        testCases: testCases ?? this.props.verification.testCases,
      },
    });
  }

  /**
   * Add a test case.
   */
  addTestCase(testCase: TestCase): Skill {
    return this.withUpdates({
      verification: {
        ...this.props.verification,
        testCases: [...this.props.verification.testCases, testCase],
      },
    });
  }

  /**
   * Add a trigger pattern.
   */
  addTrigger(trigger: string): Skill {
    if (this.props.triggers.includes(trigger)) {
      return this;
    }
    return this.withUpdates({
      triggers: [...this.props.triggers, trigger],
    });
  }

  /**
   * Enable the skill.
   */
  enable(): Skill {
    if (this.props.enabled) return this;
    return this.withUpdates({ enabled: true });
  }

  /**
   * Disable the skill.
   */
  disable(): Skill {
    if (!this.props.enabled) return this;
    return this.withUpdates({ enabled: false });
  }

  /**
   * Promote to global scope.
   */
  promoteToGlobal(): Skill {
    if (this.props.scope === "global") return this;
    return this.withUpdates({
      scope: "global",
      projectPath: null,
    });
  }

  /**
   * Update implementation.
   */
  updateImplementation(implementation: SkillImplementation): Skill {
    return this.withUpdates({
      implementation,
      verification: {
        ...this.props.verification,
        verificationScore: 0, // Reset verification when code changes
        lastVerifiedAt: null,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private withUpdates(updates: Partial<SkillProps>): Skill {
    return new Skill({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }

  /**
   * Check if a trigger matches this skill.
   */
  matchesTrigger(input: string): boolean {
    const normalizedInput = input.toLowerCase().trim();
    return this.props.triggers.some((trigger) =>
      normalizedInput.includes(trigger.toLowerCase())
    );
  }

  /**
   * Get dependencies (other skills this depends on).
   */
  getDependencies(): string[] {
    if (this.props.implementation.type !== "composite") {
      return [];
    }
    return this.props.composedFrom;
  }

  /**
   * Convert to plain object for serialization.
   */
  toPlainObject(): SkillProps {
    return { ...this.props };
  }
}
