/**
 * PortMonitor - Application service for runtime port awareness and conflict detection.
 *
 * This service extends port conflict detection beyond database-level tracking to
 * include actual runtime port usage. It can check if ports are actually in use
 * on the system using lsof, providing more accurate conflict detection.
 *
 * Key capabilities:
 * - Track active ports from running sessions
 * - Detect conflicts at runtime (not just database)
 * - Suggest alternatives based on actual usage
 * - Check if ports are actually listening (lsof)
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Information about an active port from a running session.
 */
export interface ActivePort {
  sessionId: string;
  sessionName: string;
  port: number;
  variableName: string;
  folderId: string | null;
}

/**
 * Result of port validation with runtime checks.
 */
export interface PortValidationWithRuntimeResult {
  /** Database conflicts (same port allocated to another folder) */
  databaseConflicts: PortDatabaseConflict[];
  /** Runtime conflicts (ports actually in use on the system) */
  runtimeConflicts: PortRuntimeConflict[];
  /** True if any conflict was found */
  hasConflicts: boolean;
}

/**
 * A conflict found in the port registry database.
 */
export interface PortDatabaseConflict {
  port: number;
  variableName: string;
  conflictingFolderId: string;
  conflictingFolderName: string;
  conflictingVariableName: string;
  suggestedPort: number | null;
}

/**
 * A conflict found at runtime (port actually in use).
 */
export interface PortRuntimeConflict {
  port: number;
  variableName: string;
  processId: number | null;
  processName: string | null;
  suggestedPort: number | null;
}

/**
 * Adapter interface for port registry operations.
 * Allows PortMonitor to be decoupled from concrete PortRegistryService.
 */
export interface PortRegistryAdapter {
  getPortsForUser(userId: string): Promise<Array<{
    folderId: string;
    port: number;
    variableName: string;
  }>>;

  validatePorts(
    folderId: string,
    userId: string,
    envVars: Record<string, string> | null
  ): Promise<{
    conflicts: Array<{
      port: number;
      variableName: string;
      conflictingFolder: { id: string; name: string };
      conflictingVariableName: string;
      suggestedPort: number | null;
    }>;
    hasConflicts: boolean;
  }>;

  suggestAlternativePort(
    userId: string,
    preferredPort: number
  ): Promise<number | null>;
}

/**
 * Adapter interface for session repository access.
 */
export interface SessionAdapter {
  findByUser(
    userId: string
  ): Promise<Array<{
    id: string;
    name: string;
    folderId: string | null;
    tmuxSessionName: string;
    isActive: boolean;
  }>>;
}

/**
 * Adapter interface for tmux gateway access.
 */
export interface TmuxAdapter {
  getEnvironment(sessionName: string): Promise<Record<string, string>>;
  sessionExists(sessionName: string): Promise<boolean>;
}

/**
 * Options for creating a PortMonitor instance.
 */
export interface PortMonitorOptions {
  portRegistry: PortRegistryAdapter;
  sessions: SessionAdapter;
  tmux: TmuxAdapter;
}

export class PortMonitor {
  private readonly portRegistry: PortRegistryAdapter;
  private readonly sessions: SessionAdapter;
  private readonly tmux: TmuxAdapter;

  constructor(options: PortMonitorOptions) {
    this.portRegistry = options.portRegistry;
    this.sessions = options.sessions;
    this.tmux = options.tmux;
  }

  /**
   * Get all active ports from running sessions.
   *
   * Scans the environment of active tmux sessions to find port-like variables.
   */
  async getActivePorts(userId: string): Promise<ActivePort[]> {
    const activePorts: ActivePort[] = [];

    // Get all active sessions for the user
    const sessions = await this.sessions.findByUser(userId);
    const activeSessions = sessions.filter((s) => s.isActive);

    for (const session of activeSessions) {
      try {
        // Check if tmux session still exists
        const exists = await this.tmux.sessionExists(session.tmuxSessionName);
        if (!exists) continue;

        // Get session environment
        const env = await this.tmux.getEnvironment(session.tmuxSessionName);

        // Extract port-like variables
        for (const [key, value] of Object.entries(env)) {
          if (this.isPortVariable(key, value)) {
            const port = parseInt(value, 10);
            if (!isNaN(port)) {
              activePorts.push({
                sessionId: session.id,
                sessionName: session.name,
                port,
                variableName: key,
                folderId: session.folderId,
              });
            }
          }
        }
      } catch {
        // Session may have been killed, skip it
        continue;
      }
    }

    return activePorts;
  }

  /**
   * Validate ports with both database and runtime checks.
   *
   * Performs database-level conflict detection (same port allocated to
   * multiple folders) and runtime detection (port actually in use on system).
   */
  async validateWithRuntimeCheck(
    folderId: string,
    userId: string,
    envVars: Record<string, string> | null
  ): Promise<PortValidationWithRuntimeResult> {
    if (!envVars) {
      return {
        databaseConflicts: [],
        runtimeConflicts: [],
        hasConflicts: false,
      };
    }

    // Get database conflicts
    const dbResult = await this.portRegistry.validatePorts(folderId, userId, envVars);
    const databaseConflicts: PortDatabaseConflict[] = dbResult.conflicts.map((c) => ({
      port: c.port,
      variableName: c.variableName,
      conflictingFolderId: c.conflictingFolder.id,
      conflictingFolderName: c.conflictingFolder.name,
      conflictingVariableName: c.conflictingVariableName,
      suggestedPort: c.suggestedPort,
    }));

    // Extract port variables for runtime check
    const portVars = this.extractPortVariables(envVars);
    const runtimeConflicts: PortRuntimeConflict[] = [];

    for (const { variableName, port } of portVars) {
      const inUse = await this.checkPortInUse(port);
      if (inUse) {
        const processInfo = await this.getPortProcessInfo(port);
        const suggested = await this.suggestAvailablePort(userId, port, true);
        runtimeConflicts.push({
          port,
          variableName,
          processId: processInfo?.pid ?? null,
          processName: processInfo?.name ?? null,
          suggestedPort: suggested,
        });
      }
    }

    return {
      databaseConflicts,
      runtimeConflicts,
      hasConflicts: databaseConflicts.length > 0 || runtimeConflicts.length > 0,
    };
  }

  /**
   * Suggest an available port based on actual usage.
   *
   * @param userId - User ID for database checks
   * @param preferredPort - The preferred starting port
   * @param excludeActive - Whether to exclude ports from active sessions
   */
  async suggestAvailablePort(
    userId: string,
    preferredPort: number,
    excludeActive: boolean = true
  ): Promise<number | null> {
    // Get used ports from database
    const dbPorts = await this.portRegistry.getPortsForUser(userId);
    const usedPorts = new Set(dbPorts.map((p) => p.port));

    // Get active ports if excluding them
    if (excludeActive) {
      const activePorts = await this.getActivePorts(userId);
      for (const ap of activePorts) {
        usedPorts.add(ap.port);
      }
    }

    // Try ports near the preferred port
    for (let offset = 1; offset <= 100; offset++) {
      const candidate = preferredPort + offset;
      if (
        candidate >= 1024 &&
        candidate <= 65535 &&
        !usedPorts.has(candidate) &&
        !this.isReservedPort(candidate)
      ) {
        // Check if actually available at runtime
        const inUse = await this.checkPortInUse(candidate);
        if (!inUse) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Check if a port is currently in use on the system.
   *
   * Uses lsof to detect if any process is listening on the port.
   */
  async checkPortInUse(port: number): Promise<boolean> {
    try {
      // Use lsof to check if port is in use
      // -i :PORT checks for network connections on the port
      // -t returns only PIDs (quiet mode)
      await execAsync(`lsof -t -i :${port}`);
      // If lsof returns successfully, the port is in use
      return true;
    } catch {
      // If lsof fails (exit code non-zero), the port is not in use
      return false;
    }
  }

  /**
   * Get information about the process using a port.
   */
  private async getPortProcessInfo(port: number): Promise<{ pid: number; name: string } | null> {
    try {
      // Get PID and process name using lsof
      const { stdout } = await execAsync(`lsof -t -i :${port} | head -1`);
      const pid = parseInt(stdout.trim(), 10);
      if (isNaN(pid)) return null;

      // Get process name from PID
      const { stdout: nameOutput } = await execAsync(`ps -p ${pid} -o comm= 2>/dev/null || true`);
      const name = nameOutput.trim() || "unknown";

      return { pid, name };
    } catch {
      return null;
    }
  }

  /**
   * Check if a variable name and value represent a port.
   */
  private isPortVariable(name: string, value: string): boolean {
    const portPatterns = /port|_port$/i;
    if (!portPatterns.test(name)) return false;

    const num = parseInt(value, 10);
    return !isNaN(num) && num >= 1 && num <= 65535;
  }

  /**
   * Extract port variables from environment.
   */
  private extractPortVariables(
    envVars: Record<string, string>
  ): Array<{ variableName: string; port: number }> {
    const result: Array<{ variableName: string; port: number }> = [];

    for (const [key, value] of Object.entries(envVars)) {
      if (this.isPortVariable(key, value)) {
        const port = parseInt(value, 10);
        if (!isNaN(port)) {
          result.push({ variableName: key, port });
        }
      }
    }

    return result;
  }

  /**
   * Check if a port is reserved/well-known.
   */
  private isReservedPort(port: number): boolean {
    // Well-known reserved ports
    const reserved = new Set([
      22, // SSH
      80, // HTTP
      443, // HTTPS
      3000, // Common dev port
      3306, // MySQL
      5432, // PostgreSQL
      6379, // Redis
      8080, // HTTP alternate
      27017, // MongoDB
    ]);
    return reserved.has(port);
  }
}
