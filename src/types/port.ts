/**
 * Port Management Type Definitions
 *
 * Types for framework detection, port monitoring, and port allocation tracking.
 */

// =============================================================================
// Framework Detection
// =============================================================================

/**
 * Confidence level for framework detection
 */
export type FrameworkConfidence = "high" | "medium" | "low";

/**
 * Supported framework identifiers
 */
export type FrameworkId =
  | "nextjs"
  | "vite"
  | "cra" // Create React App
  | "express"
  | "fastify"
  | "nestjs"
  | "django"
  | "flask"
  | "fastapi"
  | "rails"
  | "angular"
  | "vue"
  | "svelte"
  | "remix"
  | "astro"
  | "unknown";

/**
 * Runtime/package manager detection
 */
export type RuntimeId = "bun" | "node" | "npm" | "yarn" | "pnpm" | "python" | "ruby" | "unknown";

/**
 * Port suggestion for a framework
 */
export interface FrameworkPort {
  /** Environment variable name (e.g., "PORT", "VITE_PORT") */
  variableName: string;
  /** Default port number */
  defaultPort: number;
  /** Human-readable description */
  description: string;
}

/**
 * Framework signature for detection
 */
export interface FrameworkSignature {
  /** Unique framework identifier */
  id: FrameworkId;
  /** Display name */
  name: string;
  /** Primary port suggestions */
  ports: FrameworkPort[];
  /** Detection rules */
  detection: {
    /** package.json dependencies to check */
    packageDeps?: string[];
    /** package.json devDependencies to check */
    packageDevDeps?: string[];
    /** Config files that indicate this framework */
    configFiles?: string[];
    /** Python requirements.txt packages */
    pythonPackages?: string[];
    /** Ruby Gemfile gems */
    rubyGems?: string[];
  };
}

/**
 * Result of framework detection for a folder
 */
export interface DetectedFramework {
  /** Framework identifier */
  id: FrameworkId;
  /** Display name */
  name: string;
  /** Detection confidence */
  confidence: FrameworkConfidence;
  /** Whether framework was detected */
  detected: boolean;
  /** Path to config file that triggered detection */
  configPath?: string;
  /** Suggested ports for this framework */
  suggestedPorts: FrameworkPort[];
}

/**
 * Result of runtime/package manager detection
 */
export interface DetectedRuntime {
  /** Runtime identifier */
  id: RuntimeId;
  /** Display name */
  name: string;
  /** Version if detected */
  version?: string;
  /** Lockfile that triggered detection */
  lockfile?: string;
}

// =============================================================================
// Port Allocation
// =============================================================================

/**
 * Port allocation with folder information
 */
export interface PortAllocationWithFolder {
  /** Unique port allocation ID */
  id: string;
  /** Port number */
  port: number;
  /** Environment variable name */
  variableName: string;
  /** Folder ID */
  folderId: string;
  /** Folder name for display */
  folderName: string;
  /** Whether port is currently listening on localhost */
  isActive: boolean;
  /** When the allocation was created */
  createdAt: Date;
}

/**
 * Port status from monitoring
 */
export interface PortStatus {
  /** Port number */
  port: number;
  /** Whether port is listening */
  isListening: boolean;
  /** Process using the port (if detected) */
  process?: string;
  /** PID of process (if detected) */
  pid?: number;
}

// =============================================================================
// Port Context State
// =============================================================================

/**
 * Port monitoring configuration
 */
export interface PortMonitoringConfig {
  /** Whether monitoring is enabled */
  enabled: boolean;
  /** Polling interval in milliseconds */
  intervalMs: number;
  /** Last successful check timestamp */
  lastCheck: Date | null;
}

/**
 * Port context state
 */
export interface PortState {
  /** All port allocations for the user */
  allocations: PortAllocationWithFolder[];
  /** Ports currently listening on localhost */
  activePorts: Set<number>;
  /** Detected frameworks per folder */
  frameworks: Map<string, DetectedFramework[]>;
  /** Detected runtime per folder */
  runtimes: Map<string, DetectedRuntime>;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: string | null;
  /** Monitoring configuration */
  monitoring: PortMonitoringConfig;
}

/**
 * Port context actions
 */
export interface PortContextValue extends PortState {
  /** Refresh all port allocations */
  refreshAllocations: () => Promise<void>;
  /** Detect frameworks for a folder */
  detectFrameworks: (folderId: string, workingDirectory: string | null) => Promise<DetectedFramework[]>;
  /** Detect runtime for a folder */
  detectRuntime: (folderId: string, workingDirectory: string | null) => Promise<DetectedRuntime>;
  /** Get allocations for a specific folder */
  getAllocationsForFolder: (folderId: string) => PortAllocationWithFolder[];
  /** Check if a port is available (not allocated or is allocated to same folder) */
  isPortAvailable: (port: number, folderId: string) => boolean;
  /** Check if a port is currently listening */
  isPortActive: (port: number) => boolean;
  /** Toggle port monitoring */
  toggleMonitoring: (enabled: boolean) => void;
  /** Trigger immediate port check */
  checkPortsNow: () => Promise<void>;
}

// =============================================================================
// API Types
// =============================================================================

/**
 * Response from port allocations API
 */
export interface PortAllocationsResponse {
  allocations: PortAllocationWithFolder[];
}

/**
 * Response from port status API
 */
export interface PortStatusResponse {
  ports: PortStatus[];
  checkedAt: string;
}

/**
 * Input for adding a framework port to a folder
 */
export interface AddFrameworkPortInput {
  folderId: string;
  variableName: string;
  port: number;
}
