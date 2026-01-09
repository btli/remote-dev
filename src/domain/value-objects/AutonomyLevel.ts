/**
 * AutonomyLevel - Value object representing the level of autonomy for task execution.
 *
 * Levels:
 * - manual: Orchestrator plans but doesn't execute. User must confirm each step.
 * - confirm: Orchestrator plans and prepares execution, but waits for user confirmation before starting.
 * - full: Orchestrator plans and executes autonomously, only notifying on completion or error.
 */

import { InvalidValueError } from "../errors/DomainError";

const VALID_LEVELS = ["manual", "confirm", "full"] as const;
type LevelValue = (typeof VALID_LEVELS)[number];

export class AutonomyLevel {
  private constructor(private readonly value: LevelValue) {}

  /**
   * Create an AutonomyLevel from a string value.
   * @throws InvalidValueError if the value is not a valid level
   */
  static fromString(value: string): AutonomyLevel {
    if (!VALID_LEVELS.includes(value as LevelValue)) {
      throw new InvalidValueError(
        "AutonomyLevel",
        value,
        `Must be one of: ${VALID_LEVELS.join(", ")}`
      );
    }
    return new AutonomyLevel(value as LevelValue);
  }

  /** Create a manual level (lowest autonomy) */
  static manual(): AutonomyLevel {
    return new AutonomyLevel("manual");
  }

  /** Create a confirm level (medium autonomy) */
  static confirm(): AutonomyLevel {
    return new AutonomyLevel("confirm");
  }

  /** Create a full level (highest autonomy) */
  static full(): AutonomyLevel {
    return new AutonomyLevel("full");
  }

  /** Get the string value of this level */
  toString(): LevelValue {
    return this.value;
  }

  /** Check if this is manual level */
  isManual(): boolean {
    return this.value === "manual";
  }

  /** Check if this is confirm level */
  isConfirm(): boolean {
    return this.value === "confirm";
  }

  /** Check if this is full level */
  isFull(): boolean {
    return this.value === "full";
  }

  /** Check if this level requires user confirmation before execution */
  requiresConfirmation(): boolean {
    return this.value !== "full";
  }

  /** Check if this level allows automatic execution */
  allowsAutoExecution(): boolean {
    return this.value === "full";
  }

  /** Check if this level allows automatic planning */
  allowsAutoPlanning(): boolean {
    return this.value !== "manual";
  }

  /** Get the numeric value for comparison (higher = more autonomous) */
  numericValue(): number {
    switch (this.value) {
      case "manual":
        return 0;
      case "confirm":
        return 1;
      case "full":
        return 2;
    }
  }

  /** Check if this level is more autonomous than another */
  isMoreAutonomousThan(other: AutonomyLevel): boolean {
    return this.numericValue() > other.numericValue();
  }

  /** Check if this level is less autonomous than another */
  isLessAutonomousThan(other: AutonomyLevel): boolean {
    return this.numericValue() < other.numericValue();
  }

  /** Value equality */
  equals(other: AutonomyLevel): boolean {
    return this.value === other.value;
  }

  /** Get all valid autonomy levels */
  static allLevels(): AutonomyLevel[] {
    return VALID_LEVELS.map((v) => new AutonomyLevel(v));
  }
}
