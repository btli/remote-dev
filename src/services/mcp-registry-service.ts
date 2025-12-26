/**
 * MCPRegistryService - Manages MCP server configurations
 *
 * Handles CRUD operations for MCP servers with support for global (null folderId)
 * and folder-specific servers. Supports inheritance similar to agent configs.
 */

import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import { eq, and, isNull, asc } from "drizzle-orm";
import type {
  MCPServer,
  MCPTransport,
  CreateMCPServerInput,
  UpdateMCPServerInput,
} from "@/types/agent";

/**
 * Get all MCP servers for a user
 */
export async function getServers(userId: string): Promise<MCPServer[]> {
  const servers = await db.query.mcpServers.findMany({
    where: eq(mcpServers.userId, userId),
    orderBy: [asc(mcpServers.name)],
  });

  return servers.map(mapDbToServer);
}

/**
 * Get global MCP servers (no folder association)
 */
export async function getGlobalServers(userId: string): Promise<MCPServer[]> {
  const servers = await db.query.mcpServers.findMany({
    where: and(eq(mcpServers.userId, userId), isNull(mcpServers.folderId)),
    orderBy: [asc(mcpServers.name)],
  });

  return servers.map(mapDbToServer);
}

/**
 * Get MCP servers for a specific folder
 */
export async function getFolderServers(
  folderId: string,
  userId: string
): Promise<MCPServer[]> {
  const servers = await db.query.mcpServers.findMany({
    where: and(
      eq(mcpServers.userId, userId),
      eq(mcpServers.folderId, folderId)
    ),
    orderBy: [asc(mcpServers.name)],
  });

  return servers.map(mapDbToServer);
}

/**
 * Get resolved MCP servers for a folder (global + folder-specific)
 */
export async function getResolvedServers(
  folderId: string,
  userId: string
): Promise<{
  global: MCPServer[];
  folder: MCPServer[];
  all: MCPServer[];
}> {
  const [global, folder] = await Promise.all([
    getGlobalServers(userId),
    getFolderServers(folderId, userId),
  ]);

  // Combine global and folder servers
  // Folder servers with same name override global ones
  const serverMap = new Map<string, MCPServer>();

  for (const server of global) {
    serverMap.set(server.name, server);
  }

  for (const server of folder) {
    serverMap.set(server.name, server);
  }

  const all = Array.from(serverMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return { global, folder, all };
}

/**
 * Get a single MCP server by ID
 */
export async function getServer(
  serverId: string,
  userId: string
): Promise<MCPServer | null> {
  const server = await db.query.mcpServers.findFirst({
    where: and(eq(mcpServers.id, serverId), eq(mcpServers.userId, userId)),
  });

  return server ? mapDbToServer(server) : null;
}

/**
 * Create a new MCP server
 */
export async function createServer(
  userId: string,
  input: CreateMCPServerInput
): Promise<MCPServer> {
  const now = new Date();

  const [server] = await db
    .insert(mcpServers)
    .values({
      userId,
      folderId: input.folderId ?? null,
      name: input.name,
      transport: input.transport,
      command: input.command,
      args: JSON.stringify(input.args ?? []),
      env: JSON.stringify(input.env ?? {}),
      enabled: input.enabled ?? true,
      autoStart: input.autoStart ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return mapDbToServer(server);
}

/**
 * Update an MCP server
 */
export async function updateServer(
  serverId: string,
  userId: string,
  input: UpdateMCPServerInput
): Promise<MCPServer | null> {
  const existing = await getServer(serverId, userId);
  if (!existing) {
    return null;
  }

  const updateData: Partial<typeof mcpServers.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.transport !== undefined) updateData.transport = input.transport;
  if (input.command !== undefined) updateData.command = input.command;
  if (input.args !== undefined) updateData.args = JSON.stringify(input.args);
  if (input.env !== undefined) updateData.env = JSON.stringify(input.env);
  if (input.enabled !== undefined) updateData.enabled = input.enabled;
  if (input.autoStart !== undefined) updateData.autoStart = input.autoStart;

  const [updated] = await db
    .update(mcpServers)
    .set(updateData)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.userId, userId)))
    .returning();

  return mapDbToServer(updated);
}

/**
 * Delete an MCP server
 */
export async function deleteServer(
  serverId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.userId, userId)));

  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Toggle enabled state for an MCP server
 */
export async function toggleServerEnabled(
  serverId: string,
  userId: string,
  enabled: boolean
): Promise<MCPServer | null> {
  const [updated] = await db
    .update(mcpServers)
    .set({
      enabled,
      updatedAt: new Date(),
    })
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.userId, userId)))
    .returning();

  if (!updated) return null;
  return mapDbToServer(updated);
}

/**
 * Update last health check timestamp
 */
export async function updateHealthCheck(
  serverId: string,
  userId: string
): Promise<void> {
  await db
    .update(mcpServers)
    .set({
      lastHealthCheck: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.userId, userId)));
}

/**
 * Get enabled servers that should auto-start
 */
export async function getAutoStartServers(userId: string): Promise<MCPServer[]> {
  const servers = await db.query.mcpServers.findMany({
    where: and(
      eq(mcpServers.userId, userId),
      eq(mcpServers.enabled, true),
      eq(mcpServers.autoStart, true)
    ),
    orderBy: [asc(mcpServers.name)],
  });

  return servers.map(mapDbToServer);
}

/**
 * Copy servers from one folder to another
 */
export async function copyFolderServers(
  sourceFolderId: string,
  targetFolderId: string,
  userId: string
): Promise<MCPServer[]> {
  const sourceServers = await getFolderServers(sourceFolderId, userId);
  const now = new Date();

  const created: MCPServer[] = [];
  for (const server of sourceServers) {
    const [newServer] = await db
      .insert(mcpServers)
      .values({
        userId,
        folderId: targetFolderId,
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: JSON.stringify(server.args),
        env: JSON.stringify(server.env),
        enabled: server.enabled,
        autoStart: server.autoStart,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    created.push(mapDbToServer(newServer));
  }

  return created;
}

/**
 * Map database record to MCPServer type
 */
function mapDbToServer(record: typeof mcpServers.$inferSelect): MCPServer {
  return {
    id: record.id,
    userId: record.userId,
    folderId: record.folderId ?? undefined,
    name: record.name,
    transport: record.transport as MCPTransport,
    command: record.command,
    args: JSON.parse(record.args) as string[],
    env: JSON.parse(record.env) as Record<string, string>,
    enabled: record.enabled,
    autoStart: record.autoStart,
    lastHealthCheck: record.lastHealthCheck
      ? new Date(record.lastHealthCheck)
      : undefined,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

// Error class for service-specific errors
export class MCPRegistryServiceError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "MCPRegistryServiceError";
  }
}
