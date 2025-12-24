/**
 * Environment Variable Resolution Library
 *
 * Resolves environment variables with hierarchical inheritance:
 * User Settings -> Grandparent Folder -> Parent Folder -> Child Folder
 *
 * Supports three operations:
 * - Inherit: Variable passes through from parent (key not present)
 * - Override: Child sets a new value for an inherited key
 * - Disable: Child sets "__DISABLED__" to remove an inherited key
 */

import type {
  EnvironmentVariables,
  EnvVarSource,
  ResolvedEnvVar,
  ResolvedEnvironment,
} from "@/types/environment";
import { isEnvVarDisabled } from "@/types/environment";
import type { FolderPreferencesWithMeta } from "@/types/preferences";

/**
 * Resolve environment variables with hierarchical inheritance.
 *
 * The resolution follows these rules:
 * 1. Variables merge from each level, with children overriding parents
 * 2. A key set to "__DISABLED__" removes the variable from the result
 * 3. A disabled key can be re-enabled by setting it to a value in a child
 *
 * @param userEnvVars - User-level environment variables (optional)
 * @param folderPrefsChain - Ordered array from ancestor to target folder
 * @returns Resolved environment with source tracking
 */
export function resolveEnvironmentVariables(
  userEnvVars: EnvironmentVariables | null,
  folderPrefsChain: FolderPreferencesWithMeta[]
): ResolvedEnvironment {
  // Track the current merged state as we process each layer
  const mergedVars: Map<
    string,
    {
      value: string;
      source: EnvVarSource;
      originalValue?: string;
      originalSource?: EnvVarSource;
    }
  > = new Map();

  // Track disabled keys separately
  const disabledKeys = new Set<string>();

  // Layer 1: Apply user settings
  if (userEnvVars) {
    for (const [key, value] of Object.entries(userEnvVars)) {
      if (isEnvVarDisabled(value)) {
        disabledKeys.add(key);
      } else {
        mergedVars.set(key, { value, source: { type: "user" } });
      }
    }
  }

  // Layer 2+: Apply folder chain (ancestors first, then children)
  for (const folderPrefs of folderPrefsChain) {
    const envVars = folderPrefs.environmentVars;
    if (!envVars) continue;

    const folderSource: EnvVarSource = {
      type: "folder",
      folderId: folderPrefs.folderId,
      folderName: folderPrefs.folderName,
    };

    for (const [key, value] of Object.entries(envVars)) {
      if (isEnvVarDisabled(value)) {
        // Child explicitly disables this variable
        const existing = mergedVars.get(key);
        if (existing) {
          // Keep track of original for UI display
          mergedVars.set(key, {
            ...existing,
            originalValue: existing.value,
            originalSource: existing.source,
          });
        }
        disabledKeys.add(key);
      } else {
        // Child sets or overrides the variable
        const existing = mergedVars.get(key);

        // Re-enable if previously disabled
        disabledKeys.delete(key);

        mergedVars.set(key, {
          value,
          source: folderSource,
          // Track if this is an override (had a previous value)
          originalValue: existing?.value,
          originalSource: existing?.source,
        });
      }
    }
  }

  // Build final variables (excluding disabled)
  const variables: Record<string, string> = {};
  for (const [key, { value }] of mergedVars) {
    if (!disabledKeys.has(key)) {
      variables[key] = value;
    }
  }

  // Build details array for UI with full source tracking
  const details: ResolvedEnvVar[] = [];

  for (const [key, entry] of mergedVars) {
    const isDisabled = disabledKeys.has(key);
    const isOverridden = entry.originalValue !== undefined;

    details.push({
      key,
      value: entry.value,
      source: entry.source,
      isDisabled,
      isOverridden,
      originalValue: entry.originalValue,
      originalSource: entry.originalSource,
    });
  }

  // Sort details by key for consistent ordering
  details.sort((a, b) => a.key.localeCompare(b.key));

  return {
    variables,
    details,
    disabledKeys: Array.from(disabledKeys),
  };
}

/**
 * Merge environment variables for terminal session.
 *
 * Combines resolved folder environment with the system environment,
 * with folder environment taking precedence.
 *
 * @param systemEnv - System environment (typically process.env)
 * @param folderEnv - Resolved folder environment variables
 * @returns Merged environment ready for PTY spawn
 */
export function mergeEnvironmentForTerminal(
  systemEnv: Record<string, string | undefined>,
  folderEnv: Record<string, string> | null
): Record<string, string> {
  // Start with system environment, filtered to remove undefined values
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(systemEnv)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  // Overlay folder environment
  if (folderEnv) {
    for (const [key, value] of Object.entries(folderEnv)) {
      merged[key] = value;
    }
  }

  return merged;
}

/**
 * Parse environment variables from JSON string.
 *
 * Safe parser that handles invalid JSON gracefully.
 *
 * @param json - JSON string from database
 * @returns Parsed environment variables or null
 */
export function parseEnvironmentVars(
  json: string | null
): EnvironmentVariables | null {
  if (!json) return null;

  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn("Invalid environment variables format, expected object");
      return null;
    }
    return parsed as EnvironmentVariables;
  } catch (error) {
    console.warn("Failed to parse environment variables JSON:", error);
    return null;
  }
}

/**
 * Serialize environment variables to JSON string.
 *
 * @param envVars - Environment variables to serialize
 * @returns JSON string or null if empty
 */
export function serializeEnvironmentVars(
  envVars: EnvironmentVariables | null | undefined
): string | null {
  if (!envVars || Object.keys(envVars).length === 0) {
    return null;
  }
  return JSON.stringify(envVars);
}

/**
 * Get a human-readable label for an environment variable source.
 */
export function getEnvVarSourceLabel(source: EnvVarSource): string {
  if (source.type === "user") {
    return "User settings";
  }
  return `Inherited from: ${source.folderName}`;
}

/**
 * Check if environment variables contain any port-like values.
 *
 * Useful for quick checks before running full port validation.
 */
export function hasPortVariables(envVars: EnvironmentVariables | null): boolean {
  if (!envVars) return false;

  const portPattern = /^\d{2,5}$/;

  for (const value of Object.values(envVars)) {
    if (isEnvVarDisabled(value)) continue;
    const trimmed = value.trim();
    if (portPattern.test(trimmed)) {
      const port = parseInt(trimmed, 10);
      if (port >= 1024 && port <= 65535) {
        return true;
      }
    }
  }

  return false;
}
