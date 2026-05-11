/**
 * Secrets Provider Factory
 *
 * Factory pattern for creating secrets provider instances.
 * Supports the Phase.dev provider.
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

    default:
      throw new SecretsServiceError(
        `Unknown secrets provider: ${provider}`,
        "UNKNOWN_PROVIDER",
        provider
      );
  }
}

/**
 * Check if a provider is supported.
 *
 * Retained as a runtime guard for DB drift — old rows could carry a
 * provider string that is no longer in the type union.
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
