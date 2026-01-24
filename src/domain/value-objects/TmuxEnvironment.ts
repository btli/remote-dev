/**
 * TmuxEnvironment - Immutable value object for tmux session environment variables.
 *
 * Represents a set of environment variables that can be set at the tmux session level
 * using `tmux set-environment`. Unlike shell exports, these persist across shell exits
 * and are inherited by all processes in the session.
 *
 * Key benefits over shell exports:
 * - Survives shell crashes/exits
 * - Inherited by all child processes automatically
 * - No shell-specific syntax (works with bash, zsh, fish, etc.)
 * - Can be queried with `tmux show-environment`
 */

import { InvalidValueError } from "../errors/DomainError";

/**
 * Pattern for valid environment variable names.
 * - Must start with a letter or underscore
 * - Can contain letters, digits, and underscores
 * - Common convention is UPPER_SNAKE_CASE but we allow lowercase for compatibility
 */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Maximum length for environment variable values.
 * Shell and OS limits vary, but 32KB is a safe upper limit.
 */
const MAX_VALUE_LENGTH = 32768;

export class TmuxEnvironment {
  private readonly vars: ReadonlyMap<string, string>;

  private constructor(vars: Map<string, string>) {
    this.vars = vars;
  }

  /**
   * Create a TmuxEnvironment from a plain object.
   * Validates all keys and values.
   * @throws InvalidValueError if any key or value is invalid
   */
  static create(vars: Record<string, string>): TmuxEnvironment {
    const map = new Map<string, string>();

    for (const [key, value] of Object.entries(vars)) {
      TmuxEnvironment.validateKey(key);
      TmuxEnvironment.validateValue(key, value);
      map.set(key, value);
    }

    return new TmuxEnvironment(map);
  }

  /**
   * Create an empty TmuxEnvironment.
   */
  static empty(): TmuxEnvironment {
    return new TmuxEnvironment(new Map());
  }

  /**
   * Validate an environment variable key.
   * @throws InvalidValueError if the key is invalid
   */
  private static validateKey(key: string): void {
    if (!key || typeof key !== "string") {
      throw new InvalidValueError(
        "TmuxEnvironment key",
        key,
        "Must be a non-empty string"
      );
    }

    if (!ENV_KEY_PATTERN.test(key)) {
      throw new InvalidValueError(
        "TmuxEnvironment key",
        key,
        "Must start with a letter or underscore and contain only alphanumeric characters and underscores"
      );
    }
  }

  /**
   * Validate an environment variable value.
   * @throws InvalidValueError if the value is invalid
   */
  private static validateValue(key: string, value: string): void {
    if (typeof value !== "string") {
      throw new InvalidValueError(
        `TmuxEnvironment value for '${key}'`,
        value,
        "Must be a string"
      );
    }

    if (value.length > MAX_VALUE_LENGTH) {
      throw new InvalidValueError(
        `TmuxEnvironment value for '${key}'`,
        `(${value.length} chars)`,
        `Exceeds maximum length of ${MAX_VALUE_LENGTH} characters`
      );
    }

    // Check for null bytes which can cause issues
    if (value.includes("\0")) {
      throw new InvalidValueError(
        `TmuxEnvironment value for '${key}'`,
        "(contains null byte)",
        "Cannot contain null bytes"
      );
    }
  }

  /**
   * Merge with another TmuxEnvironment.
   * Returns a new TmuxEnvironment with combined variables.
   *
   * @param other - The environment to merge with
   * @param precedence - Which environment's values take precedence on conflict
   *   - 'this': Values from this environment override other's values
   *   - 'other': Values from other environment override this environment's values
   */
  merge(other: TmuxEnvironment, precedence: "this" | "other"): TmuxEnvironment {
    const merged = new Map<string, string>();

    if (precedence === "other") {
      // This environment first, then other overwrites
      for (const [key, value] of this.vars) {
        merged.set(key, value);
      }
      for (const [key, value] of other.vars) {
        merged.set(key, value);
      }
    } else {
      // Other environment first, then this overwrites
      for (const [key, value] of other.vars) {
        merged.set(key, value);
      }
      for (const [key, value] of this.vars) {
        merged.set(key, value);
      }
    }

    return new TmuxEnvironment(merged);
  }

  /**
   * Get the value of an environment variable.
   */
  get(key: string): string | undefined {
    return this.vars.get(key);
  }

  /**
   * Check if an environment variable is set.
   */
  has(key: string): boolean {
    return this.vars.has(key);
  }

  /**
   * Get the number of environment variables.
   */
  get size(): number {
    return this.vars.size;
  }

  /**
   * Check if the environment is empty.
   */
  isEmpty(): boolean {
    return this.vars.size === 0;
  }

  /**
   * Get all keys.
   */
  keys(): IterableIterator<string> {
    return this.vars.keys();
  }

  /**
   * Get all values.
   */
  values(): IterableIterator<string> {
    return this.vars.values();
  }

  /**
   * Get all entries as [key, value] pairs.
   */
  entries(): IterableIterator<[string, string]> {
    return this.vars.entries();
  }

  /**
   * Convert to a plain object.
   * Useful for passing to APIs that expect Record<string, string>.
   */
  toRecord(): Record<string, string> {
    const record: Record<string, string> = {};
    for (const [key, value] of this.vars) {
      record[key] = value;
    }
    return record;
  }

  /**
   * Create a new TmuxEnvironment with an additional variable.
   * Does not modify this instance.
   * @throws InvalidValueError if key or value is invalid
   */
  with(key: string, value: string): TmuxEnvironment {
    TmuxEnvironment.validateKey(key);
    TmuxEnvironment.validateValue(key, value);

    const newMap = new Map(this.vars);
    newMap.set(key, value);
    return new TmuxEnvironment(newMap);
  }

  /**
   * Create a new TmuxEnvironment without a specific variable.
   * Does not modify this instance.
   */
  without(key: string): TmuxEnvironment {
    if (!this.vars.has(key)) {
      return this;
    }
    const newMap = new Map(this.vars);
    newMap.delete(key);
    return new TmuxEnvironment(newMap);
  }

  /**
   * Create a new TmuxEnvironment with only specified keys.
   */
  pick(keys: string[]): TmuxEnvironment {
    const newMap = new Map<string, string>();
    for (const key of keys) {
      const value = this.vars.get(key);
      if (value !== undefined) {
        newMap.set(key, value);
      }
    }
    return new TmuxEnvironment(newMap);
  }

  /**
   * Create a new TmuxEnvironment excluding specified keys.
   */
  omit(keys: string[]): TmuxEnvironment {
    const keysSet = new Set(keys);
    const newMap = new Map<string, string>();
    for (const [key, value] of this.vars) {
      if (!keysSet.has(key)) {
        newMap.set(key, value);
      }
    }
    return new TmuxEnvironment(newMap);
  }

  /**
   * Value equality check.
   */
  equals(other: TmuxEnvironment): boolean {
    if (this.vars.size !== other.vars.size) {
      return false;
    }
    for (const [key, value] of this.vars) {
      if (other.vars.get(key) !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Iterate over entries with forEach.
   */
  forEach(
    callback: (value: string, key: string, env: TmuxEnvironment) => void
  ): void {
    for (const [key, value] of this.vars) {
      callback(value, key, this);
    }
  }

  /**
   * Make the class iterable.
   */
  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.vars.entries();
  }
}
