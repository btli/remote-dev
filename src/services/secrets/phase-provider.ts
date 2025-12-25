/**
 * Phase.dev Secrets Provider
 *
 * Implements the SecretsProviderClient interface for Phase.dev.
 * Uses the Phase CLI to fetch secrets securely.
 */

import { execFile } from "@/lib/exec";
import type { SecretsProviderClient } from "./types";
import type { SecretValue, SecretsValidationResult } from "@/types/secrets";

/**
 * Phase secrets provider using Phase CLI
 */
export class PhaseSecretsProvider implements SecretsProviderClient {
  private readonly app: string;
  private readonly env: string;
  private readonly path: string;
  private readonly serviceToken: string;

  constructor(config: Record<string, string>) {
    this.app = config.app;
    this.env = config.env || "development";
    this.path = config.path || "/";
    this.serviceToken = config.serviceToken;

    if (!this.app) {
      throw new Error("Phase provider requires 'app' configuration");
    }
    if (!this.serviceToken) {
      throw new Error("Phase provider requires 'serviceToken' configuration");
    }
  }

  async fetchSecrets(): Promise<SecretValue[]> {
    try {
      const args = [
        "secrets",
        "export",
        "--app",
        this.app,
        "--env",
        this.env,
        "--format",
        "json",
      ];

      // Add path if specified and not root
      if (this.path && this.path !== "/") {
        args.push("--path", this.path);
      }

      const { stdout } = await this.runPhaseCommand(args);

      // Phase CLI outputs JSON object: { "KEY": "value", ... }
      const secretsObject = JSON.parse(stdout);

      // Convert to array of SecretValue
      return Object.entries(secretsObject).map(([key, value]) => ({
        key,
        value: String(value),
      }));
    } catch (error) {
      const err = error as Error;
      throw new Error(`Failed to fetch secrets from Phase: ${this.sanitizeError(err.message)}`);
    }
  }

  async validate(): Promise<SecretsValidationResult> {
    try {
      // Try to list secrets to validate credentials
      const args = [
        "secrets",
        "list",
        "--app",
        this.app,
        "--env",
        this.env,
      ];

      await this.runPhaseCommand(args);

      // If we got here, credentials are valid
      // Try to get actual count
      try {
        const secrets = await this.fetchSecrets();
        return {
          valid: true,
          secretCount: secrets.length,
        };
      } catch {
        // Could list but not export - still valid credentials
        return { valid: true };
      }
    } catch (error) {
      const err = error as Error;
      return {
        valid: false,
        error: this.sanitizeError(err.message),
      };
    }
  }

  getDisplayName(): string {
    return `Phase (${this.app}/${this.env})`;
  }

  /**
   * Run Phase CLI command with service token
   */
  private async runPhaseCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFile("phase", args, {
      env: {
        ...process.env,
        PHASE_SERVICE_TOKEN: this.serviceToken,
        // Disable interactive prompts
        CI: "true",
      },
    });
  }

  /**
   * Sanitize error messages to prevent token leakage
   */
  private sanitizeError(message: string): string {
    return message
      .replace(/pss_service_[a-zA-Z0-9_-]+/g, "[REDACTED]")
      .replace(/pss_[a-zA-Z0-9_-]+/g, "[REDACTED]")
      .replace(new RegExp(this.serviceToken, "g"), "[REDACTED]");
  }
}
