/**
 * Type definitions for the ccflare (better-ccflare) Anthropic API proxy integration.
 */

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
 * Anthropic API key stored in the database for ccflare load balancing.
 */
export interface CcflareApiKey {
  id: string;
  userId: string;
  name: string;
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
 * Input for adding an Anthropic API key to ccflare.
 */
export interface AddCcflareKeyInput {
  name: string;
  key: string;
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
