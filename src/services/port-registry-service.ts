/**
 * PortRegistryService - Manages port allocations and conflict detection
 *
 * Tracks which ports are claimed by which projects for a user, allowing
 * detection of conflicts when multiple projects try to use the same port.
 *
 * After the project refactor, the legacy `folderId` arguments are treated
 * as project ids. Existing call sites keep their signatures for
 * backward compatibility; internally the service uses `portRegistry.projectId`.
 */
import { db } from "@/db";
import { portRegistry, projects } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import type {
  EnvironmentVariables,
  PortConflict,
  PortValidationResult,
  PortValidationWithRuntimeResult,
  PortRegistryEntry,
} from "@/types/environment";
import { extractPortVariables, RESERVED_PORTS } from "@/types/environment";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/**
 * Sync port registry for a project based on its environment variables.
 *
 * This should be called whenever a project's environment variables are updated.
 * It replaces all existing port entries for the project with the current ports.
 */
export async function syncPortRegistry(
  folderId: string,
  userId: string,
  envVars: EnvironmentVariables | null
): Promise<void> {
  // Delete existing ports for this project
  await db
    .delete(portRegistry)
    .where(
      and(eq(portRegistry.projectId, folderId), eq(portRegistry.userId, userId))
    );

  // If no env vars, we're done
  if (!envVars) return;

  // Extract port-like variables
  const ports = extractPortVariables(envVars);
  if (ports.length === 0) return;

  // Insert new port allocations
  await db.insert(portRegistry).values(
    ports.map(({ variableName, port }) => ({
      projectId: folderId,
      userId,
      port,
      variableName,
    }))
  );
}

/**
 * Validate ports and detect conflicts with other projects.
 *
 * Returns information about any conflicts found, including suggestions
 * for alternative ports. Does not modify any data.
 */
export async function validatePorts(
  folderId: string,
  userId: string,
  envVars: EnvironmentVariables | null
): Promise<PortValidationResult> {
  if (!envVars) {
    return { conflicts: [], hasConflicts: false };
  }

  const ports = extractPortVariables(envVars);
  if (ports.length === 0) {
    return { conflicts: [], hasConflicts: false };
  }

  const conflicts: PortConflict[] = [];

  for (const { variableName, port } of ports) {
    // Find existing allocations for this port (excluding current project)
    const existing = await db.query.portRegistry.findFirst({
      where: and(
        eq(portRegistry.userId, userId),
        eq(portRegistry.port, port),
        ne(portRegistry.projectId, folderId)
      ),
    });

    if (existing && existing.projectId) {
      // Get project name for display
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, existing.projectId),
        columns: { id: true, name: true },
      });

      if (project) {
        const suggested = await suggestAlternativePort(userId, port);
        conflicts.push({
          port,
          variableName,
          conflictingFolder: { id: project.id, name: project.name },
          conflictingVariableName: existing.variableName,
          suggestedPort: suggested,
        });
      }
    }
  }

  return {
    conflicts,
    hasConflicts: conflicts.length > 0,
  };
}

/**
 * Suggest an alternative port near the requested port.
 *
 * Tries to find an unused port close to the preferred port,
 * avoiding reserved ports and already-allocated ports.
 */
export async function suggestAlternativePort(
  userId: string,
  preferredPort: number
): Promise<number | null> {
  // Get all allocated ports for this user
  const allocations = await db.query.portRegistry.findMany({
    where: eq(portRegistry.userId, userId),
    columns: { port: true },
  });

  const usedPorts = new Set(allocations.map((a) => a.port));

  // Try ports near the preferred port
  for (let offset = 1; offset <= 100; offset++) {
    const candidate = preferredPort + offset;
    if (
      candidate >= 1024 &&
      candidate <= 65535 &&
      !usedPorts.has(candidate) &&
      !RESERVED_PORTS.has(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

/**
 * Get all port allocations for a user.
 */
export async function getPortsForUser(
  userId: string
): Promise<PortRegistryEntry[]> {
  const entries = await db.query.portRegistry.findMany({
    where: eq(portRegistry.userId, userId),
  });

  return entries.map(mapDbPortRegistry);
}

/**
 * Get port allocations for a specific project.
 */
export async function getPortsForFolder(
  folderId: string,
  userId: string
): Promise<PortRegistryEntry[]> {
  const entries = await db.query.portRegistry.findMany({
    where: and(
      eq(portRegistry.projectId, folderId),
      eq(portRegistry.userId, userId)
    ),
  });

  return entries.map(mapDbPortRegistry);
}

/**
 * Delete all port allocations for a project.
 *
 * Called when a project is deleted or its environment variables are cleared.
 */
export async function deletePortsForFolder(
  folderId: string,
  userId: string
): Promise<void> {
  await db
    .delete(portRegistry)
    .where(
      and(eq(portRegistry.projectId, folderId), eq(portRegistry.userId, userId))
    );
}

/**
 * Check if a specific port is available for a project.
 *
 * Returns true if the port is either unallocated or already allocated
 * to the same project (not a conflict with self).
 */
export async function isPortAvailable(
  folderId: string,
  userId: string,
  port: number
): Promise<boolean> {
  const existing = await db.query.portRegistry.findFirst({
    where: and(
      eq(portRegistry.userId, userId),
      eq(portRegistry.port, port),
      ne(portRegistry.projectId, folderId)
    ),
  });

  return !existing;
}

// ============================================================================
// Runtime Port Checking
// ============================================================================

/**
 * Check if ports are actually listening on the system.
 *
 * Uses lsof to detect if any process is listening on each port.
 * This provides runtime validation beyond database-level conflict detection.
 *
 * @param ports - Array of port numbers to check
 * @returns Array of port check results with inUse boolean
 */
export async function checkPortsInUse(
  ports: number[]
): Promise<Array<{ port: number; inUse: boolean }>> {
  const results = await Promise.all(
    ports.map(async (port) => {
      try {
        // Use lsof to check if port is in use
        // -i :PORT checks for network connections on the port
        // -sTCP:LISTEN filters to only listening sockets
        // -t returns only PIDs (quiet mode)
        const { stdout } = await execFile("lsof", [
          "-i",
          `:${port}`,
          "-sTCP:LISTEN",
          "-t",
        ]);
        return { port, inUse: stdout.trim().length > 0 };
      } catch {
        // lsof exits non-zero if nothing found
        return { port, inUse: false };
      }
    })
  );
  return results;
}

/**
 * Validate ports with both database and runtime checks.
 *
 * Performs database-level conflict detection (same port allocated to
 * multiple projects) and runtime detection (port actually in use on system).
 */
export async function validatePortsRuntime(
  folderId: string,
  userId: string,
  envVars: EnvironmentVariables | null
): Promise<PortValidationWithRuntimeResult> {
  const dbResult = await validatePorts(folderId, userId, envVars);

  if (!envVars) {
    return { ...dbResult, runtimeConflicts: [] };
  }

  const ports = extractPortVariables(envVars).map((p) => p.port);
  if (ports.length === 0) {
    return { ...dbResult, runtimeConflicts: [] };
  }

  const runtimeChecks = await checkPortsInUse(ports);
  const runtimeConflicts = runtimeChecks
    .filter((c) => c.inUse)
    .map((c) => c.port);

  return {
    ...dbResult,
    runtimeConflicts,
    hasConflicts: dbResult.hasConflicts || runtimeConflicts.length > 0,
  };
}

// ============================================================================
// Database Mappers
// ============================================================================

function mapDbPortRegistry(
  dbEntry: typeof portRegistry.$inferSelect
): PortRegistryEntry {
  return {
    id: dbEntry.id,
    projectId: dbEntry.projectId ?? null,
    userId: dbEntry.userId,
    port: dbEntry.port,
    variableName: dbEntry.variableName,
    createdAt: new Date(dbEntry.createdAt),
  };
}
