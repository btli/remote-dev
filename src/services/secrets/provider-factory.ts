/**
 * Secrets Provider Factory
 *
 * Factory pattern for creating secrets provider instances.
 * Supports Phase.dev with stubs for future providers.
 */

import type { SecretsProviderClient, ProviderFactoryInput } from "./types";
import type { SecretsProviderType } from "@/types/secrets";
import { PhaseSecretsProvider } from "./phase-provider";
import { SecretsServiceError } from "@/lib/errors";

/**
 * Create a secrets provider instance based on configuration
 */
export function createSecretsProvider(input: ProviderFactoryInput): SecretsProviderClient {
  const { provider, config } = input;

  switch (provider as SecretsProviderType) {
    case "phase":
      return new PhaseSecretsProvider(config);

    case "vault":
      throw new SecretsServiceError(
        "HashiCorp Vault provider is not yet implemented",
        "PROVIDER_NOT_IMPLEMENTED",
        "vault"
      );

    case "aws-secrets-manager":
      throw new SecretsServiceError(
        "AWS Secrets Manager provider is not yet implemented",
        "PROVIDER_NOT_IMPLEMENTED",
        "aws-secrets-manager"
      );

    case "1password":
      throw new SecretsServiceError(
        "1Password provider is not yet implemented",
        "PROVIDER_NOT_IMPLEMENTED",
        "1password"
      );

    default:
      throw new SecretsServiceError(
        `Unknown secrets provider: ${provider}`,
        "UNKNOWN_PROVIDER",
        provider
      );
  }
}

/**
 * Check if a provider is supported
 */
export function isProviderSupported(provider: string): boolean {
  return provider === "phase";
}

/**
 * Get list of all supported providers (for UI)
 */
export function getSupportedProviders(): SecretsProviderType[] {
  return ["phase"];
}

/**
 * Get list of all providers including coming soon (for UI)
 */
export function getAllProviders(): { type: SecretsProviderType; supported: boolean }[] {
  return [
    { type: "phase", supported: true },
    { type: "vault", supported: false },
    { type: "aws-secrets-manager", supported: false },
    { type: "1password", supported: false },
  ];
}
