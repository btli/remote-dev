/**
 * Environment Variable Type Definitions
 *
 * Supports hierarchical inheritance with the ability to:
 * - Override inherited variables with new values
 * - Disable inherited variables using the __DISABLED__ sentinel
 * - Track the source of each variable through the inheritance chain
 */

/**
 * Sentinel value to indicate an inherited env var should be disabled/removed.
 * When a child folder sets a variable to this value, it's excluded from the
 * resolved environment.
 *
 * Why a sentinel instead of null/undefined?
 * - null means "use inherited value" (no override)
 * - "__DISABLED__" explicitly removes the variable from the resolved environment
 * - This allows distinguishing "not set" from "intentionally removed"
 */
export const ENV_VAR_DISABLED = "__DISABLED__";

/**
 * Environment variable value - either a string value or disabled sentinel
 */
export type EnvVarValue = string;

/**
 * Raw environment variables as stored in database.
 *
 * Values can be:
 * - Regular string: the actual value to use
 * - "__DISABLED__": explicitly disable this inherited variable
 *
 * Null/undefined keys are not stored (they inherit from parent).
 */
export type EnvironmentVariables = Record<string, EnvVarValue>;

/**
 * Source of an environment variable in the inheritance chain.
 *
 * Mirrors PreferenceSource from preferences.ts for consistency.
 */
export type EnvVarSource =
  | { type: "user" }
  | { type: "folder"; folderId: string; folderName: string };

/**
 * A single resolved environment variable with full metadata.
 *
 * Used in the UI to show:
 * - The current effective value
 * - Where it came from (source)
 * - Whether it's been overridden from an ancestor
 * - Whether it's been explicitly disabled
 */
export interface ResolvedEnvVar {
  /** Variable name (e.g., "PORT", "API_URL") */
  key: string;

  /**
   * The effective value.
   * - For active vars: the actual value
   * - For disabled vars: the original inherited value (for UI display)
   */
  value: string;

  /** Where this variable's value originated */
  source: EnvVarSource;

  /** True if this variable is explicitly disabled in the current context */
  isDisabled: boolean;

  /**
   * True if this value overrides an ancestor's value.
   * Useful for showing "overrides X" in the UI.
   */
  isOverridden: boolean;

  /**
   * The original value from parent if this was overridden.
   * Used to show what was overridden in the UI.
   */
  originalValue?: string;

  /**
   * The source of the original value if overridden.
   * Used to show "overrides value from X" in the UI.
   */
  originalSource?: EnvVarSource;
}

/**
 * Fully resolved environment for a folder or session.
 *
 * Contains both the final merged environment (for terminal use)
 * and detailed metadata (for UI display).
 */
export interface ResolvedEnvironment {
  /**
   * Final merged environment variables (excludes disabled vars).
   * This is what gets passed to the terminal PTY.
   */
  variables: Record<string, string>;

  /**
   * All variables with full source tracking (includes disabled).
   * Used for UI display to show inheritance chain.
   */
  details: ResolvedEnvVar[];

  /**
   * Keys of variables that are explicitly disabled.
   * Convenience property for quick lookup.
   */
  disabledKeys: string[];
}

/**
 * Port conflict information returned by validation.
 *
 * Provides enough context to display a meaningful warning
 * and suggest an alternative port.
 */
export interface PortConflict {
  /** The conflicting port number */
  port: number;

  /** The variable name in the current folder (e.g., "PORT") */
  variableName: string;

  /** Details about the folder that already claims this port */
  conflictingFolder: {
    id: string;
    name: string;
  };

  /** The variable name in the conflicting folder (e.g., "DEV_PORT") */
  conflictingVariableName: string;

  /** Suggested alternative port, or null if none available */
  suggestedPort: number | null;
}

/**
 * Result of port validation check.
 *
 * Returns all conflicts detected and a convenience flag.
 */
export interface PortValidationResult {
  /** Array of all port conflicts detected */
  conflicts: PortConflict[];

  /** True if any conflicts were detected */
  hasConflicts: boolean;
}

/**
 * Port registry entry as stored in database.
 *
 * Tracks which ports are claimed by which folders for conflict detection.
 */
export interface PortRegistryEntry {
  id: string;
  folderId: string;
  userId: string;
  port: number;
  variableName: string;
  createdAt: Date;
}

/**
 * Input for updating folder environment variables.
 *
 * Used in API requests and service methods.
 */
export interface UpdateEnvironmentInput {
  environmentVars: EnvironmentVariables | null;
}

/**
 * Check if a value represents a disabled variable.
 */
export function isEnvVarDisabled(value: string): boolean {
  return value === ENV_VAR_DISABLED;
}

/**
 * Validate an environment variable key.
 *
 * Requirements:
 * - Must start with a letter (A-Z)
 * - Can contain uppercase letters, numbers, and underscores
 * - Cannot be empty
 *
 * @returns Error message if invalid, null if valid
 */
export function validateEnvVarKey(key: string): string | null {
  if (!key || key.trim().length === 0) {
    return "Variable name cannot be empty";
  }

  // Must match pattern: starts with letter, contains only A-Z, 0-9, _
  const validPattern = /^[A-Z][A-Z0-9_]*$/;
  if (!validPattern.test(key)) {
    return "Variable name must start with a letter and contain only uppercase letters, numbers, and underscores";
  }

  return null;
}

/**
 * Validate an environment variable value.
 *
 * Requirements:
 * - Maximum length of 10KB (10240 characters)
 *
 * @returns Error message if invalid, null if valid
 */
export function validateEnvVarValue(value: string): string | null {
  const MAX_VALUE_LENGTH = 10240; // 10KB

  if (value.length > MAX_VALUE_LENGTH) {
    return `Value is too long (max ${MAX_VALUE_LENGTH} characters)`;
  }

  return null;
}

/**
 * Extract port-like variables from an environment.
 *
 * Detects variables whose values look like valid port numbers (1024-65535).
 * Used for port conflict detection.
 *
 * @param envVars - Environment variables to scan
 * @returns Array of variable names and their port numbers
 */
export function extractPortVariables(
  envVars: EnvironmentVariables
): Array<{ variableName: string; port: number }> {
  const ports: Array<{ variableName: string; port: number }> = [];
  const portPattern = /^\d{2,5}$/;

  for (const [key, value] of Object.entries(envVars)) {
    // Skip disabled variables
    if (isEnvVarDisabled(value)) continue;

    const trimmedValue = value.trim();
    if (portPattern.test(trimmedValue)) {
      const port = parseInt(trimmedValue, 10);
      // Valid user port range (1024-65535)
      if (port >= 1024 && port <= 65535) {
        ports.push({ variableName: key, port });
      }
    }
  }

  return ports;
}

/**
 * Common port numbers that are typically reserved by well-known services.
 * Used when suggesting alternative ports to avoid these.
 */
export const RESERVED_PORTS = new Set([
  3000, // Common dev server port
  3001, // Common dev server alternate
  5432, // PostgreSQL
  5672, // RabbitMQ
  6379, // Redis
  8080, // HTTP alternate
  8443, // HTTPS alternate
  9200, // Elasticsearch
  27017, // MongoDB
]);
