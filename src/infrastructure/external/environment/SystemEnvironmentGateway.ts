/**
 * SystemEnvironmentGateway - Infrastructure implementation of EnvironmentGateway.
 *
 * This implementation provides access to the real system environment via process.env,
 * with filtering to exclude framework internals and validation for shell safety.
 */

import {
  type EnvironmentGateway,
  FRAMEWORK_ENV_PREFIXES,
} from "@/application/ports/EnvironmentGateway";
import { TmuxEnvironment } from "@/domain/value-objects/TmuxEnvironment";

export class SystemEnvironmentGateway implements EnvironmentGateway {
  /**
   * Get the current process environment, filtered to remove framework internals.
   */
  getProcessEnvironment(): TmuxEnvironment {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (this.isFrameworkVariable(key)) continue;

      env[key] = value;
    }

    return TmuxEnvironment.create(env);
  }

  /**
   * Get system default environment variables.
   */
  getSystemDefaults(): TmuxEnvironment {
    return TmuxEnvironment.create({
      HOME: this.getHome(),
      USER: this.getUser(),
      SHELL: this.getShell(),
      PATH: process.env.PATH || "/usr/bin:/bin",
      TERM: "xterm-256color",
      LANG: process.env.LANG || "en_US.UTF-8",
    });
  }

  /**
   * Validate that environment variables are safe for shell use.
   */
  validateForShell(vars: TmuxEnvironment): boolean {
    for (const [key, value] of vars) {
      // Validate key format (should already be validated by TmuxEnvironment)
      if (!this.isValidEnvKey(key)) {
        return false;
      }

      // Check for null bytes
      if (value.includes("\0")) {
        return false;
      }

      // Check for reasonable length (32KB max)
      if (value.length > 32768) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get a specific environment variable from the system.
   */
  get(key: string): string | undefined {
    return process.env[key];
  }

  /**
   * Check if a specific environment variable is set.
   */
  has(key: string): boolean {
    return key in process.env && process.env[key] !== undefined;
  }

  /**
   * Get HOME directory from the system.
   */
  getHome(): string {
    return process.env.HOME || "/tmp";
  }

  /**
   * Get current user name from the system.
   */
  getUser(): string {
    return process.env.USER || "unknown";
  }

  /**
   * Get default shell from the system.
   */
  getShell(): string {
    return process.env.SHELL || "/bin/bash";
  }

  /**
   * Check if a variable name is a framework internal.
   */
  private isFrameworkVariable(key: string): boolean {
    return FRAMEWORK_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
  }

  /**
   * Validate environment variable key format.
   */
  private isValidEnvKey(key: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
  }
}
