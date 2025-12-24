/**
 * PortRegistryService - Manages port allocations and conflict detection
 *
 * Tracks which ports are claimed by which folders for a user, allowing
 * detection of conflicts when multiple projects try to use the same port.
 */
import { db } from "@/db";
import { portRegistry, sessionFolders } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import type {
  EnvironmentVariables,
  PortConflict,
  PortValidationResult,
  PortRegistryEntry,
} from "@/types/environment";
import { extractPortVariables, RESERVED_PORTS } from "@/types/environment";

/**
 * Sync port registry for a folder based on its environment variables.
 *
 * This should be called whenever a folder's environment variables are updated.
 * It replaces all existing port entries for the folder with the current ports.
 */
export async function syncPortRegistry(
  folderId: string,
  userId: string,
  envVars: EnvironmentVariables | null
): Promise<void> {
  // Delete existing ports for this folder
  await db
    .delete(portRegistry)
    .where(
      and(eq(portRegistry.folderId, folderId), eq(portRegistry.userId, userId))
    );

  // If no env vars, we're done
  if (!envVars) return;

  // Extract port-like variables
  const ports = extractPortVariables(envVars);
  if (ports.length === 0) return;

  // Insert new port allocations
  await db.insert(portRegistry).values(
    ports.map(({ variableName, port }) => ({
      folderId,
      userId,
      port,
      variableName,
    }))
  );
}

/**
 * Validate ports and detect conflicts with other folders.
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
    // Find existing allocations for this port (excluding current folder)
    const existing = await db.query.portRegistry.findFirst({
      where: and(
        eq(portRegistry.userId, userId),
        eq(portRegistry.port, port),
        ne(portRegistry.folderId, folderId)
      ),
    });

    if (existing) {
      // Get folder name for display
      const folder = await db.query.sessionFolders.findFirst({
        where: eq(sessionFolders.id, existing.folderId),
        columns: { id: true, name: true },
      });

      if (folder) {
        const suggested = await suggestAlternativePort(userId, port);
        conflicts.push({
          port,
          variableName,
          conflictingFolder: { id: folder.id, name: folder.name },
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
 * Get port allocations for a specific folder.
 */
export async function getPortsForFolder(
  folderId: string,
  userId: string
): Promise<PortRegistryEntry[]> {
  const entries = await db.query.portRegistry.findMany({
    where: and(
      eq(portRegistry.folderId, folderId),
      eq(portRegistry.userId, userId)
    ),
  });

  return entries.map(mapDbPortRegistry);
}

/**
 * Delete all port allocations for a folder.
 *
 * Called when a folder is deleted or its environment variables are cleared.
 */
export async function deletePortsForFolder(
  folderId: string,
  userId: string
): Promise<void> {
  await db
    .delete(portRegistry)
    .where(
      and(eq(portRegistry.folderId, folderId), eq(portRegistry.userId, userId))
    );
}

/**
 * Check if a specific port is available for a folder.
 *
 * Returns true if the port is either unallocated or already allocated
 * to the same folder (not a conflict with self).
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
      ne(portRegistry.folderId, folderId)
    ),
  });

  return !existing;
}

// ============================================================================
// Database Mappers
// ============================================================================

function mapDbPortRegistry(
  dbEntry: typeof portRegistry.$inferSelect
): PortRegistryEntry {
  return {
    id: dbEntry.id,
    folderId: dbEntry.folderId,
    userId: dbEntry.userId,
    port: dbEntry.port,
    variableName: dbEntry.variableName,
    createdAt: new Date(dbEntry.createdAt),
  };
}
