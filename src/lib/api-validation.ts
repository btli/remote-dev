/**
 * Shared API validation utilities
 *
 * Provides common validation functions used across multiple API routes.
 */

import { resolve } from "path";
import type { EnvironmentVariables } from "@/types/environment";
import { validateEnvVarKey, validateEnvVarValue } from "@/types/environment";

/**
 * Validate a project path to prevent path traversal attacks.
 * SECURITY: Ensures paths are within allowed directories.
 *
 * @param path - The path to validate
 * @returns Resolved path if valid, undefined if invalid
 */
export function validateProjectPath(path: string | undefined): string | undefined {
  if (!path) return undefined;

  // Must be absolute path
  if (!path.startsWith("/")) {
    return undefined;
  }

  // Resolve to canonical path (removes .., ., etc.)
  const resolved = resolve(path);

  // Must be within home directory or /tmp
  const home = process.env.HOME || "/tmp";
  if (!resolved.startsWith(home) && !resolved.startsWith("/tmp")) {
    return undefined;
  }

  return resolved;
}

/**
 * Check if a string is a valid UUID
 *
 * @param str - The string to check
 * @returns True if the string is a valid UUID
 */
export function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Result type for environment variable validation
 */
type EnvVarsValidationResult =
  | { valid: true; value: EnvironmentVariables | null }
  | { valid: false; error: string };

/**
 * Validate environment variables input
 *
 * @param envVars - The environment variables to validate
 * @returns Validation result with either the validated value or an error message
 */
export function validateEnvironmentVars(envVars: unknown): EnvVarsValidationResult {
  // null or undefined are allowed (clear all env vars)
  if (envVars === null || envVars === undefined) {
    return { valid: true, value: null };
  }

  // Must be an object
  if (typeof envVars !== "object" || Array.isArray(envVars)) {
    return { valid: false, error: "environmentVars must be an object or null" };
  }

  const validated: EnvironmentVariables = {};

  for (const [key, value] of Object.entries(envVars as Record<string, unknown>)) {
    // Validate key
    const keyError = validateEnvVarKey(key);
    if (keyError) {
      return { valid: false, error: `Invalid key "${key}": ${keyError}` };
    }

    // Value must be a string
    if (typeof value !== "string") {
      return { valid: false, error: `Value for "${key}" must be a string` };
    }

    // Validate value
    const valueError = validateEnvVarValue(value);
    if (valueError) {
      return { valid: false, error: `Invalid value for "${key}": ${valueError}` };
    }

    validated[key] = value;
  }

  return { valid: true, value: Object.keys(validated).length > 0 ? validated : null };
}
