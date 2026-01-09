/**
 * TaskType - Value object representing the category of an orchestrator task.
 *
 * Task types help determine:
 * - Which agent is best suited for the task
 * - What context to inject
 * - How to evaluate success
 */

import { InvalidValueError } from "../errors/DomainError";

const VALID_TYPES = [
  "feature",      // New functionality
  "bug",          // Bug fix
  "refactor",     // Code improvement without behavior change
  "test",         // Writing or fixing tests
  "documentation", // Documentation updates
  "research",     // Investigation/exploration
  "review",       // Code review
  "maintenance",  // Dependency updates, cleanup
] as const;
type TypeValue = (typeof VALID_TYPES)[number];

// Agent recommendations per task type
const RECOMMENDED_AGENTS: Record<TypeValue, string[]> = {
  feature: ["claude", "codex"],
  bug: ["claude", "codex"],
  refactor: ["claude"],
  test: ["codex", "claude"],
  documentation: ["claude", "gemini"],
  research: ["gemini", "claude"],
  review: ["claude"],
  maintenance: ["codex", "claude"],
};

export class TaskType {
  private constructor(private readonly value: TypeValue) {}

  /**
   * Create a TaskType from a string value.
   * @throws InvalidValueError if the value is not a valid type
   */
  static fromString(value: string): TaskType {
    if (!VALID_TYPES.includes(value as TypeValue)) {
      throw new InvalidValueError(
        "TaskType",
        value,
        `Must be one of: ${VALID_TYPES.join(", ")}`
      );
    }
    return new TaskType(value as TypeValue);
  }

  /** Create a feature type */
  static feature(): TaskType {
    return new TaskType("feature");
  }

  /** Create a bug type */
  static bug(): TaskType {
    return new TaskType("bug");
  }

  /** Create a refactor type */
  static refactor(): TaskType {
    return new TaskType("refactor");
  }

  /** Create a test type */
  static test(): TaskType {
    return new TaskType("test");
  }

  /** Create a documentation type */
  static documentation(): TaskType {
    return new TaskType("documentation");
  }

  /** Create a research type */
  static research(): TaskType {
    return new TaskType("research");
  }

  /** Create a review type */
  static review(): TaskType {
    return new TaskType("review");
  }

  /** Create a maintenance type */
  static maintenance(): TaskType {
    return new TaskType("maintenance");
  }

  /** Get the string value of this type */
  toString(): TypeValue {
    return this.value;
  }

  /** Get recommended agents for this task type (in priority order) */
  getRecommendedAgents(): string[] {
    return RECOMMENDED_AGENTS[this.value];
  }

  /** Check if this is a feature task */
  isFeature(): boolean {
    return this.value === "feature";
  }

  /** Check if this is a bug fix task */
  isBug(): boolean {
    return this.value === "bug";
  }

  /** Check if this is a refactor task */
  isRefactor(): boolean {
    return this.value === "refactor";
  }

  /** Check if this is a test task */
  isTest(): boolean {
    return this.value === "test";
  }

  /** Check if this is a documentation task */
  isDocumentation(): boolean {
    return this.value === "documentation";
  }

  /** Check if this is a research task */
  isResearch(): boolean {
    return this.value === "research";
  }

  /** Check if this is a review task */
  isReview(): boolean {
    return this.value === "review";
  }

  /** Check if this is a maintenance task */
  isMaintenance(): boolean {
    return this.value === "maintenance";
  }

  /** Check if this task type typically requires code changes */
  requiresCodeChanges(): boolean {
    return ["feature", "bug", "refactor", "test", "maintenance"].includes(this.value);
  }

  /** Check if this task type benefits from worktree isolation */
  shouldUseWorktree(): boolean {
    return ["feature", "refactor"].includes(this.value);
  }

  /** Value equality */
  equals(other: TaskType): boolean {
    return this.value === other.value;
  }

  /** Get all valid task types */
  static allTypes(): TaskType[] {
    return VALID_TYPES.map((v) => new TaskType(v));
  }
}
