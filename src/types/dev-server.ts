/**
 * Dev Server Type Definitions
 *
 * Types for managing development server sessions with browser preview functionality.
 * Dev servers are special session types that:
 * - Run a dev server command (e.g., `bun run dev`)
 * - Optionally run a build command first
 * - Expose a port for browser preview via reverse proxy
 * - Support health monitoring and crash detection
 */

/**
 * Session types to distinguish between regular terminals and dev servers
 */
export type SessionType = "terminal" | "dev-server";

/**
 * Tab types for the session manager
 */
export type TabType = "terminal" | "preview";

/**
 * Dev server lifecycle status
 */
export type DevServerStatus = "starting" | "running" | "crashed" | "stopped";

/**
 * Health check result for a dev server
 */
export interface DevServerHealth {
  id: string;
  sessionId: string;
  isHealthy: boolean;
  port: number | null;
  url: string | null;
  lastHealthCheck: Date | null;
  crashedAt: Date | null;
  crashReason: string | null;
  consecutiveFailures: number;
  cpuPercent: number | null;
  memoryMb: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Complete dev server state including session and health
 */
export interface DevServerState {
  sessionId: string;
  folderId: string;
  folderName: string;
  port: number;
  status: DevServerStatus;
  proxyUrl: string;
  health: DevServerHealth | null;
  isStarting: boolean;
}

/**
 * Input for starting a dev server
 */
export interface StartDevServerInput {
  folderId: string;
}

/**
 * Response from starting a dev server
 */
export interface StartDevServerResponse {
  sessionId: string;
  port: number;
  proxyUrl: string;
  status: DevServerStatus;
}

/**
 * Dev server configuration stored in folder preferences
 */
export interface DevServerConfig {
  serverStartupCommand: string | null;
  buildCommand: string | null;
  runBuildBeforeStart: boolean;
}

/**
 * Active dev server info for a folder
 */
export interface ActiveDevServer {
  sessionId: string;
  folderId: string;
  port: number;
  status: DevServerStatus;
  proxyUrl: string;
  startedAt: Date;
}

/**
 * Proxy request context
 */
export interface ProxyContext {
  slug: string;
  path: string;
  folderId: string;
  sessionId: string;
  port: number;
  userId: string;
}

/**
 * CSS class names for dev server status badges
 * Used across ProcessesModal and ProcessesTable for consistent styling
 */
export const DEV_SERVER_STATUS_STYLES: Record<DevServerStatus, string> = {
  running: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  starting: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  crashed: "bg-red-500/10 text-red-400 border-red-500/30",
  stopped: "bg-slate-500/10 text-slate-400 border-slate-500/30",
} as const;

/**
 * Health check configuration
 */
export const HEALTH_CHECK_CONFIG = {
  /** Interval between health checks in milliseconds */
  intervalMs: 10_000,
  /** Number of consecutive failures before marking as crashed */
  failureThreshold: 3,
  /** Timeout for health check request in milliseconds */
  timeoutMs: 5_000,
  /** Maximum time to wait for server to start in milliseconds */
  startupTimeoutMs: 60_000,
} as const;

/**
 * Slugify a string for use in URLs
 * Converts folder names to URL-safe slugs
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/[\s_-]+/g, "-") // Replace spaces/underscores with hyphens
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}

/**
 * Generate proxy URL for a folder
 */
export function getProxyUrl(folderName: string): string {
  return `/api/proxy/${slugify(folderName)}/`;
}
