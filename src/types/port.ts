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
  /** Whether port is currently listening on localhost (alias of `isListening`) */
  isActive: boolean;
  /** When the allocation was created */
  createdAt: Date;

  // --- Live runtime fields (populated by GET /api/ports via a single lsof scan) ---
  /** Whether the port is currently listening on localhost (live scan). */
  isListening?: boolean;
  /** PID of the listening process, if detected. */
  pid?: number | null;
  /** Name of the listening process, if detected. */
  process?: string | null;
  /** Owning session id, when a runtime claim matches this port. */
  sessionId?: string | null;
  /** Owning session name, when a runtime claim matches this port. */
  sessionName?: string | null;
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

// =============================================================================
// Proxyable Ports Seam (A4)
// =============================================================================

/**
 * A single proxyable port — the FROZEN contract consumed by Track B (the
 * in-pod HTTP/WebSocket proxy) via `GET /api/ports/proxyable`.
 *
 * A port is proxyable when it is in the user's (= instance's) live universe:
 * either currently `listening` on the system, `claim`ed by a running session,
 * or `both`. The route filters this set through `isPortProxyable` so privileged
 * ports (< 1024) and the hard-blocked instance ports (6001/6002) never appear.
 *
 * DO NOT change this shape without coordinating with B2/A5 — they match it.
 */
export interface ProxyablePort {
  /** Port number (always passes `isPortProxyable`). */
  port: number;
  /** Whether the port is currently listening on the system (live scan). */
  isListening: boolean;
  /** PID of the listening process, if known. */
  pid: number | null;
  /** Name of the listening process, if known. */
  process: string | null;
  /** Owning session id, if the port is associated with a claim. */
  sessionId: string | null;
  /** Owning session name, if resolvable. */
  sessionName: string | null;
  /** Owning project id, if the port is associated with a claim. */
  projectId: string | null;
  /** Source variable name (e.g. "PORT"), if the port is associated with a claim. */
  variableName: string | null;
  /**
   * Where this port came from:
   * - `"listening"` — observed on the system but not claimed by any session.
   * - `"claim"` — claimed by a running session but not (yet) observed listening.
   * - `"both"` — claimed AND currently listening.
   */
  source: "listening" | "claim" | "both";
}

/**
 * Response from `GET /api/ports/proxyable`.
 */
export interface ProxyablePortsResponse {
  ports: ProxyablePort[];
}

/**
 * An active port discovered from a running session's tmux environment.
 *
 * Mirrors the `ActivePort` shape returned by `PortMonitor.getActivePorts`.
 * Used by `GET /api/ports/active` for additive discovery — these ports may not
 * be in the declarative registry.
 */
export interface ActivePortInfo {
  sessionId: string;
  sessionName: string;
  port: number;
  variableName: string;
  projectId: string | null;
}

/**
 * Response from `GET /api/ports/active`.
 */
export interface ActivePortsResponse {
  activePorts: ActivePortInfo[];
}
