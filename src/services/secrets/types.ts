/**
 * Secrets Provider Interface
 *
 * Defines the contract that all secrets providers must implement.
 * This abstraction allows easy addition of new providers (Vault, AWS, 1Password).
 */

import type { SecretValue, SecretsValidationResult } from "@/types/secrets";

/**
 * Provider interface - Strategy pattern for secrets retrieval
 */
export interface SecretsProviderClient {
  /**
   * Fetch all secrets from the provider
   * @returns Array of key-value pairs
   */
  fetchSecrets(): Promise<SecretValue[]>;

  /**
   * Validate provider configuration and credentials
   * @returns Validation result with optional error message
   */
  validate(): Promise<SecretsValidationResult>;

  /**
   * Get display name for the provider (for UI)
   */
  getDisplayName(): string;
}

/**
 * Provider configuration passed to factory
 */
export interface ProviderFactoryInput {
  provider: string;
  config: Record<string, string>;
}
