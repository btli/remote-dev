/**
 * Secrets Management Type Definitions
 *
 * Implements a provider abstraction for external secrets managers.
 * Phase.dev is the only supported provider.
 */

/**
 * Supported secrets providers
 */
export type SecretsProviderType = "phase";

/**
 * Individual secret value
 */
export interface SecretValue {
  key: string;
  value: string;
}

/**
 * Provider-specific configuration
 */
export interface PhaseProviderConfig {
  app: string;
  env: string;
  path?: string;
  serviceToken: string;
}

/**
 * Generic provider config for storage
 */
export interface SecretsProviderConfigData {
  provider: SecretsProviderType;
  config: Record<string, string>;
}

/**
 * Folder secrets configuration stored in database
 */
export interface FolderSecretsConfig {
  id: string;
  folderId: string;
  userId: string;
  provider: SecretsProviderType;
  providerConfig: Record<string, string>;
  enabled: boolean;
  lastFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating/updating folder secrets config
 */
export interface UpdateFolderSecretsConfigInput {
  provider: SecretsProviderType;
  config: Record<string, string>;
  enabled?: boolean;
}

/**
 * Validation result from testing provider connection
 */
export interface SecretsValidationResult {
  valid: boolean;
  error?: string;
  secretCount?: number;
}

/**
 * Result from fetching secrets
 */
export interface FetchSecretsResult {
  secrets: Record<string, string>;
  fetchedAt: Date;
  provider: SecretsProviderType;
}

/**
 * Provider display info for UI
 */
export interface SecretsProviderInfo {
  type: SecretsProviderType;
  name: string;
  description: string;
  icon: string;
  configFields: SecretsConfigField[];
}

/**
 * Config field definition for dynamic UI rendering
 */
export interface SecretsConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  placeholder?: string;
  required: boolean;
  options?: { value: string; label: string }[];
  helpText?: string;
}

/**
 * Provider definitions for UI
 */
export const SECRETS_PROVIDERS: SecretsProviderInfo[] = [
  {
    type: "phase",
    name: "Phase",
    description: "End-to-end encrypted secrets management",
    icon: "shield",
    configFields: [
      {
        key: "serviceToken",
        label: "Service Token",
        type: "password",
        placeholder: "pss_service_...",
        required: true,
        helpText: "Create a service token at console.phase.dev or via: phase tokens create",
      },
      {
        key: "app",
        label: "App Name",
        type: "text",
        placeholder: "my-project",
        required: true,
        helpText: "The Phase app name to fetch secrets from",
      },
      {
        key: "env",
        label: "Environment",
        type: "select",
        required: true,
        options: [
          { value: "development", label: "Development" },
          { value: "staging", label: "Staging" },
          { value: "production", label: "Production" },
        ],
      },
      {
        key: "path",
        label: "Path",
        type: "text",
        placeholder: "/",
        required: false,
        helpText: "Optional path prefix for secrets (default: /)",
      },
    ],
  },
];

/**
 * Get provider info by type
 */
export function getProviderInfo(type: SecretsProviderType): SecretsProviderInfo | undefined {
  return SECRETS_PROVIDERS.find((p) => p.type === type);
}
