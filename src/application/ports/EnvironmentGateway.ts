/**
 * EnvironmentGateway - Port interface for system environment access.
 *
 * This interface abstracts access to the system's environment variables,
 * allowing the application layer to work with environment without directly
 * accessing process.env. This enables:
 *
 * - Filtering out framework internals (__NEXT_PRIVATE_*, etc.)
 * - Consistent defaults across the application
 * - Easy mocking in tests
 * - Validation before use in shell contexts
 */

import type { TmuxEnvironment } from "@/domain/value-objects/TmuxEnvironment";

/**
 * Framework environment variable prefixes to filter out.
 * These are internal to frameworks and should not be inherited.
 */
export const FRAMEWORK_ENV_PREFIXES = [
  "__NEXT_PRIVATE_",
  "__NEXT_ACTION_",
  "__VITE_",
  "__TURBOPACK_",
  "npm_",
  "npm_config_",
  "NX_",
  "VERCEL_",
] as const;

/**
 * Environment variables required for basic shell operation.
 */
export const REQUIRED_SHELL_VARS = ["HOME", "USER", "SHELL", "PATH"] as const;

export interface EnvironmentGateway {
  /**
   * Get the current process environment, filtered to remove framework internals.
   *
   * This returns environment variables that are safe and useful to inherit
   * in child processes, excluding:
   * - Framework internals (__NEXT_PRIVATE_*, __VITE_*, etc.)
   * - Package manager internals (npm_*, etc.)
   * - Build tool variables (NX_*, etc.)
   *
   * @returns Filtered process environment as TmuxEnvironment
   */
  getProcessEnvironment(): TmuxEnvironment;

  /**
   * Get system default environment variables.
   *
   * These are the minimum variables needed for a shell to function:
   * - HOME: User's home directory
   * - USER: Current user name
   * - SHELL: User's default shell
   * - PATH: Command search path
   * - TERM: Terminal type (defaults to xterm-256color)
   *
   * @returns System defaults as TmuxEnvironment
   */
  getSystemDefaults(): TmuxEnvironment;

  /**
   * Validate that environment variables are safe for shell use.
   *
   * Checks for:
   * - Valid variable names (alphanumeric + underscore, starting with letter or underscore)
   * - No null bytes in values
   * - Reasonable value lengths
   *
   * @param vars - Environment variables to validate
   * @returns true if all variables are safe, false otherwise
   */
  validateForShell(vars: TmuxEnvironment): boolean;

  /**
   * Get a specific environment variable from the system.
   *
   * @param key - Environment variable name
   * @returns The value, or undefined if not set
   */
  get(key: string): string | undefined;

  /**
   * Check if a specific environment variable is set.
   *
   * @param key - Environment variable name
   * @returns true if the variable is set
   */
  has(key: string): boolean;

  /**
   * Get HOME directory from the system.
   * Falls back to /tmp if HOME is not set.
   */
  getHome(): string;

  /**
   * Get current user name from the system.
   * Falls back to 'unknown' if USER is not set.
   */
  getUser(): string;

  /**
   * Get default shell from the system.
   * Falls back to /bin/bash if SHELL is not set.
   */
  getShell(): string;
}
