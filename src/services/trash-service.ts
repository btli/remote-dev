/**
 * TrashService - Generic trash management for soft-delete functionality
 *
 * This service handles the generic aspects of trash management:
 * - Listing trash items
 * - Querying trash item details
 * - Cleaning up expired items
 *
 * Resource-specific operations (trash, restore, delete) are delegated
 * to type-specific services (e.g., worktree-trash-service.ts)
 */

import { db } from "@/db";
import { trashItems, worktreeTrashMetadata, terminalSessions } from "@/db/schema";
import { eq, and, lt, desc, inArray } from "drizzle-orm";
import type {
  TrashItem,
  TrashResourceType,
  TrashItemWithMetadata,
  WorktreeTrashItem,
  CleanupResult,
} from "@/types/trash";
import * as WorktreeTrashService from "./worktree-trash-service";
import { TrashServiceError } from "@/lib/errors";

// Re-export for backwards compatibility
export { TrashServiceError };

/**
 * List all trash items for a user (basic info only)
 * @param userId - User ID to filter by
 * @param resourceType - Optional filter by resource type
 * @returns Array of trash items (without detailed metadata)
 */
export async function listTrashItems(
  userId: string,
  resourceType?: TrashResourceType
): Promise<TrashItem[]> {
  const conditions = [eq(trashItems.userId, userId)];

  if (resourceType) {
    conditions.push(eq(trashItems.resourceType, resourceType));
  }

  const items = await db.query.trashItems.findMany({
    where: and(...conditions),
    orderBy: [desc(trashItems.trashedAt)],
  });

  return items.map((item) => ({
    id: item.id,
    userId: item.userId,
    resourceType: item.resourceType as TrashResourceType,
    resourceId: item.resourceId,
    resourceName: item.resourceName,
    trashedAt: item.trashedAt,
    expiresAt: item.expiresAt,
  }));
}

/**
 * List all trash items for a user with full metadata
 * @param userId - User ID to filter by
 * @param resourceType - Optional filter by resource type
 * @returns Array of trash items with metadata
 */
export async function listTrashItemsWithMetadata(
  userId: string,
  resourceType?: TrashResourceType
): Promise<TrashItemWithMetadata[]> {
  const conditions = [eq(trashItems.userId, userId)];

  if (resourceType) {
    conditions.push(eq(trashItems.resourceType, resourceType));
  }

  const items = await db.query.trashItems.findMany({
    where: and(...conditions),
    orderBy: [desc(trashItems.trashedAt)],
  });

  // Filter to worktree items only (currently the only supported type)
  const worktreeItems = items.filter((item) => item.resourceType === "worktree");
  if (worktreeItems.length === 0) return [];

  // Batch fetch all metadata in one query
  const itemIds = worktreeItems.map((item) => item.id);
  const allMetadata = await db.query.worktreeTrashMetadata.findMany({
    where: inArray(worktreeTrashMetadata.trashItemId, itemIds),
  });

  // Build lookup map
  const metadataMap = new Map(allMetadata.map((m) => [m.trashItemId, m]));

  return worktreeItems
    .filter((item) => metadataMap.has(item.id))
    .map((item) => {
      const metadata = metadataMap.get(item.id)!;
      return {
        id: item.id,
        userId: item.userId,
        resourceType: "worktree" as const,
        resourceId: item.resourceId,
        resourceName: item.resourceName,
        trashedAt: item.trashedAt,
        expiresAt: item.expiresAt,
        metadata: {
          id: metadata.id,
          trashItemId: metadata.trashItemId,
          githubRepoId: metadata.githubRepoId,
          repoName: metadata.repoName,
          repoLocalPath: metadata.repoLocalPath,
          worktreeBranch: metadata.worktreeBranch,
          worktreeOriginalPath: metadata.worktreeOriginalPath,
          worktreeTrashPath: metadata.worktreeTrashPath,
          originalFolderId: metadata.originalFolderId,
          originalFolderName: metadata.originalFolderName,
          createdAt: metadata.createdAt,
        },
      };
    });
}

/**
 * Get a single trash item with full metadata
 * @param trashItemId - Trash item ID
 * @param userId - User ID for authorization
 * @returns Trash item with metadata or null if not found
 */
export async function getTrashItem(
  trashItemId: string,
  userId: string
): Promise<TrashItemWithMetadata | null> {
  const item = await db.query.trashItems.findFirst({
    where: and(
      eq(trashItems.id, trashItemId),
      eq(trashItems.userId, userId)
    ),
  });

  if (!item) {
    return null;
  }

  const baseItem: TrashItem = {
    id: item.id,
    userId: item.userId,
    resourceType: item.resourceType as TrashResourceType,
    resourceId: item.resourceId,
    resourceName: item.resourceName,
    trashedAt: item.trashedAt,
    expiresAt: item.expiresAt,
  };

  // Get resource-specific metadata
  if (item.resourceType === "worktree") {
    const metadata = await db.query.worktreeTrashMetadata.findFirst({
      where: eq(worktreeTrashMetadata.trashItemId, item.id),
    });

    if (metadata) {
      return {
        ...baseItem,
        resourceType: "worktree",
        metadata: {
          id: metadata.id,
          trashItemId: metadata.trashItemId,
          githubRepoId: metadata.githubRepoId,
          repoName: metadata.repoName,
          repoLocalPath: metadata.repoLocalPath,
          worktreeBranch: metadata.worktreeBranch,
          worktreeOriginalPath: metadata.worktreeOriginalPath,
          worktreeTrashPath: metadata.worktreeTrashPath,
          originalFolderId: metadata.originalFolderId,
          originalFolderName: metadata.originalFolderName,
          createdAt: metadata.createdAt,
        },
      } as WorktreeTrashItem;
    }
  }

  // Return base item if metadata not found (shouldn't happen)
  return baseItem as TrashItemWithMetadata;
}

/**
 * Count trash items for a user
 * @param userId - User ID
 * @returns Number of items in trash
 */
export async function countTrashItems(userId: string): Promise<number> {
  const items = await db.query.trashItems.findMany({
    where: eq(trashItems.userId, userId),
    columns: { id: true },
  });
  return items.length;
}

/**
 * Trash a resource (delegates to resource-specific service)
 * @param userId - User ID
 * @param resourceType - Type of resource to trash
 * @param resourceId - ID of the resource (e.g., session ID)
 * @returns Created trash item
 */
export async function trashResource(
  userId: string,
  resourceType: TrashResourceType,
  resourceId: string
): Promise<TrashItem> {
  switch (resourceType) {
    case "worktree":
      return WorktreeTrashService.trashWorktreeSession(resourceId, userId);
    default:
      throw new TrashServiceError(
        `Unknown resource type: ${resourceType}`,
        "UNKNOWN_RESOURCE_TYPE"
      );
  }
}

/**
 * Restore a resource from trash (delegates to resource-specific service)
 * @param trashItemId - Trash item ID
 * @param userId - User ID for authorization
 * @param options - Resource-specific restore options
 */
export async function restoreResource(
  trashItemId: string,
  userId: string,
  options?: Record<string, unknown>
): Promise<void> {
  const item = await db.query.trashItems.findFirst({
    where: and(
      eq(trashItems.id, trashItemId),
      eq(trashItems.userId, userId)
    ),
  });

  if (!item) {
    throw new TrashServiceError("Trash item not found", "NOT_FOUND", trashItemId);
  }

  switch (item.resourceType) {
    case "worktree":
      await WorktreeTrashService.restoreWorktreeFromTrash(
        trashItemId,
        userId,
        options?.restorePath as string | undefined,
        options?.targetFolderId as string | null | undefined
      );
      break;
    default:
      throw new TrashServiceError(
        `Unknown resource type: ${item.resourceType}`,
        "UNKNOWN_RESOURCE_TYPE"
      );
  }
}

/**
 * Permanently delete a trash item (delegates to resource-specific service)
 * @param trashItemId - Trash item ID
 * @param userId - User ID for authorization
 */
export async function deleteTrashItem(
  trashItemId: string,
  userId: string
): Promise<void> {
  const item = await db.query.trashItems.findFirst({
    where: and(
      eq(trashItems.id, trashItemId),
      eq(trashItems.userId, userId)
    ),
  });

  if (!item) {
    throw new TrashServiceError("Trash item not found", "NOT_FOUND", trashItemId);
  }

  switch (item.resourceType) {
    case "worktree":
      await WorktreeTrashService.permanentlyDeleteWorktree(trashItemId, userId);
      break;
    default:
      throw new TrashServiceError(
        `Unknown resource type: ${item.resourceType}`,
        "UNKNOWN_RESOURCE_TYPE"
      );
  }
}

/**
 * Clean up expired trash items
 * This should be called at startup, via cron, and when viewing trash
 * @returns Summary of cleanup operation
 */
export async function cleanupExpiredItems(): Promise<CleanupResult> {
  const now = new Date();

  // Find all expired items
  const expiredItems = await db.query.trashItems.findMany({
    where: lt(trashItems.expiresAt, now),
  });

  const deletedIds: string[] = [];

  for (const item of expiredItems) {
    try {
      // Delete through resource-specific service to handle filesystem cleanup
      switch (item.resourceType) {
        case "worktree":
          await WorktreeTrashService.permanentlyDeleteWorktree(item.id, item.userId);
          break;
        default:
          // For unknown types, just delete the database records
          await db.delete(trashItems).where(eq(trashItems.id, item.id));
      }
      deletedIds.push(item.id);
    } catch (error) {
      // Log error but continue with other items
      console.error(`Failed to cleanup trash item ${item.id}:`, error);
    }
  }

  return {
    deletedCount: deletedIds.length,
    deletedIds,
  };
}

/**
 * Check if a session is currently trashed
 * @param sessionId - Session ID to check
 * @returns True if the session is in trash
 */
export async function isSessionTrashed(sessionId: string): Promise<boolean> {
  const session = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, sessionId),
    columns: { status: true },
  });

  return session?.status === "trashed";
}
