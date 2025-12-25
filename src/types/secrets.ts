/**
 * Secrets Management Type Definitions
 *
 * Implements a provider abstraction for external secrets managers.
 * Supports Phase.dev initially, with extensibility for Vault, AWS, 1Password.
 */

/**
 * Supported secrets providers
 */
export type SecretsProviderType = "phase" | "vault" | "aws-secrets-manager" | "1password";

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

export interface VaultProviderConfig {
  url: string;
  path: string;
  token: string;
}

export interface AWSSecretsProviderConfig {
  region: string;
  secretId: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface OnePasswordProviderConfig {
  vault: string;
  item: string;
  serviceAccountToken: string;
}

/**
 * Union of all provider configs
 */
export type ProviderConfig =
  | { provider: "phase"; config: PhaseProviderConfig }
  | { provider: "vault"; config: VaultProviderConfig }
  | { provider: "aws-secrets-manager"; config: AWSSecretsProviderConfig }
  | { provider: "1password"; config: OnePasswordProviderConfig };

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
  {
    type: "vault",
    name: "HashiCorp Vault",
    description: "Manage secrets and protect sensitive data",
    icon: "lock",
    configFields: [
      {
        key: "url",
        label: "Vault URL",
        type: "text",
        placeholder: "https://vault.example.com",
        required: true,
      },
      {
        key: "token",
        label: "Token",
        type: "password",
        placeholder: "hvs.xxxxx",
        required: true,
      },
      {
        key: "path",
        label: "Secret Path",
        type: "text",
        placeholder: "secret/data/myapp",
        required: true,
      },
    ],
  },
  {
    type: "aws-secrets-manager",
    name: "AWS Secrets Manager",
    description: "Rotate, manage, and retrieve database credentials and secrets",
    icon: "cloud",
    configFields: [
      {
        key: "region",
        label: "AWS Region",
        type: "text",
        placeholder: "us-east-1",
        required: true,
      },
      {
        key: "secretId",
        label: "Secret ID/ARN",
        type: "text",
        placeholder: "my-app/production",
        required: true,
      },
      {
        key: "accessKeyId",
        label: "Access Key ID",
        type: "password",
        placeholder: "AKIA...",
        required: false,
        helpText: "Optional: Uses default credentials if not provided",
      },
      {
        key: "secretAccessKey",
        label: "Secret Access Key",
        type: "password",
        required: false,
      },
    ],
  },
  {
    type: "1password",
    name: "1Password",
    description: "Enterprise password management",
    icon: "key",
    configFields: [
      {
        key: "serviceAccountToken",
        label: "Service Account Token",
        type: "password",
        placeholder: "ops_...",
        required: true,
      },
      {
        key: "vault",
        label: "Vault Name",
        type: "text",
        placeholder: "Development",
        required: true,
      },
      {
        key: "item",
        label: "Item Name",
        type: "text",
        placeholder: "API Keys",
        required: true,
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
