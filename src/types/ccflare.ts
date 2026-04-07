/**
 * Type definitions for the ccflare (better-ccflare) Anthropic API proxy integration.
 */

/** Default Anthropic API base URL. Keys with null or this value are proxy-eligible. */
export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

/**
 * ccflare proxy configuration stored in the database.
 */
export interface CcflareConfig {
  id: string;
  userId: string;
  enabled: boolean;
  autoStart: boolean;
  port: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * API key stored in the database for ccflare load balancing.
 * Keys with a null/undefined baseUrl are Anthropic keys routed through the proxy.
 * Keys with a custom baseUrl are direct-endpoint keys (OpenRouter, Databricks, etc.).
 */
export interface CcflareApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string | null;
  baseUrl: string | null;
  priority: number;
  paused: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Runtime status of the ccflare process.
 */
export interface CcflareStatus {
  installed: boolean;
  running: boolean;
  port: number | null;
  pid: number | null;
  version: string | null;
  uptime: number | null;
}

/**
 * Installation status check result.
 */
export type CcflareInstallStatus =
  | { installed: false; error?: string }
  | { installed: true; version: string; path: string };

/**
 * Input for updating ccflare config.
 */
export interface UpdateCcflareConfigInput {
  enabled?: boolean;
  autoStart?: boolean;
  port?: number;
}

/**
 * Input for adding an API key to ccflare.
 */
export interface AddCcflareKeyInput {
  name: string;
  key: string;
  baseUrl?: string;
  priority?: number;
}

/**
 * Analytics stats from ccflare's HTTP API.
 */
export interface CcflareStats {
  totalRequests: number;
  successRate: number;
  totalTokens: number;
  totalCost: number;
  activeAccounts: number;
}

/**
 * ccflare process control actions.
 */
export type CcflareControlAction = "start" | "stop" | "restart";
