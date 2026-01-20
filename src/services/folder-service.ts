/**
 * FolderService - Manages session folder CRUD operations
 */
import { db } from "@/db";
import { sessionFolders, terminalSessions } from "@/db/schema";
import { eq, and, asc, max, isNull } from "drizzle-orm";

export interface SessionFolder {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Get all folders for a user
 */
export async function getFolders(userId: string): Promise<SessionFolder[]> {
  const folders = await db.query.sessionFolders.findMany({
    where: eq(sessionFolders.userId, userId),
    orderBy: [asc(sessionFolders.sortOrder)],
  });

  return folders.map(mapDbFolder);
}

/**
 * Map database folder record to SessionFolder type
 */
function mapDbFolder(f: typeof sessionFolders.$inferSelect): SessionFolder {
  return {
    id: f.id,
    userId: f.userId,
    parentId: f.parentId ?? null,
    name: f.name,
    collapsed: f.collapsed ?? false,
    sortOrder: f.sortOrder,
    createdAt: new Date(f.createdAt),
    updatedAt: new Date(f.updatedAt),
  };
}

/**
 * Get session-to-folder mappings for a user
 */
export async function getSessionFolderMappings(
  userId: string
): Promise<Record<string, string>> {
  const sessions = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.userId, userId),
      // Only include sessions that have a folder assigned
    ),
    columns: {
      id: true,
      folderId: true,
    },
  });

  const mappings: Record<string, string> = {};
  for (const session of sessions) {
    if (session.folderId) {
      mappings[session.id] = session.folderId;
    }
  }
  return mappings;
}

/**
 * Create a new folder (optionally nested under a parent)
 */
export async function createFolder(
  userId: string,
  name: string,
  parentId?: string | null
): Promise<SessionFolder> {
  // Validate parent folder ownership if specified
  if (parentId) {
    const parentFolder = await db.query.sessionFolders.findFirst({
      where: and(
        eq(sessionFolders.id, parentId),
        eq(sessionFolders.userId, userId)
      ),
    });
    if (!parentFolder) {
      throw new Error("Parent folder not found or access denied");
    }
  }

  // Get the max sort order among siblings using SQL aggregation
  // This avoids fetching ALL folders just to compute a single MAX value
  const result = await db
    .select({ maxOrder: max(sessionFolders.sortOrder) })
    .from(sessionFolders)
    .where(
      and(
        eq(sessionFolders.userId, userId),
        parentId ? eq(sessionFolders.parentId, parentId) : isNull(sessionFolders.parentId)
      )
    );
  const maxOrder = result[0]?.maxOrder ?? -1;

  const [folder] = await db
    .insert(sessionFolders)
    .values({
      userId,
      name,
      parentId: parentId ?? null,
      sortOrder: maxOrder + 1,
    })
    .returning();

  return mapDbFolder(folder);
}

/**
 * Update a folder
 */
export async function updateFolder(
  folderId: string,
  userId: string,
  updates: Partial<{ name: string; collapsed: boolean; sortOrder: number }>
): Promise<SessionFolder | null> {
  const [updated] = await db
    .update(sessionFolders)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(
      and(eq(sessionFolders.id, folderId), eq(sessionFolders.userId, userId))
    )
    .returning();

  return updated ? mapDbFolder(updated) : null;
}

/**
 * Check if moving a folder to a new parent would create a circular reference.
 * Returns true if circular (invalid move).
 */
async function wouldCreateCircularReference(
  folderId: string,
  newParentId: string,
  allFolders: SessionFolder[]
): Promise<boolean> {
  // Build a map for quick lookup
  const folderMap = new Map(allFolders.map((f) => [f.id, f]));

  // Walk up the parent chain from newParentId
  let currentId: string | null = newParentId;
  while (currentId) {
    if (currentId === folderId) {
      return true; // Circular reference detected
    }
    const current = folderMap.get(currentId);
    currentId = current?.parentId ?? null;
  }

  return false;
}

/**
 * Move a folder to a new parent (or to root if parentId is null).
 * Validates ownership and prevents circular references.
 */
export async function moveFolderToParent(
  folderId: string,
  userId: string,
  newParentId: string | null
): Promise<SessionFolder | null> {
  // Get all folders for validation
  const allFolders = await getFolders(userId);
  const folder = allFolders.find((f) => f.id === folderId);

  if (!folder) {
    return null; // Folder not found or doesn't belong to user
  }

  // Validate new parent if specified
  if (newParentId) {
    const newParent = allFolders.find((f) => f.id === newParentId);
    if (!newParent) {
      throw new Error("Parent folder not found or access denied");
    }

    // Check for circular reference
    if (await wouldCreateCircularReference(folderId, newParentId, allFolders)) {
      throw new Error("Cannot move folder into its own descendant");
    }
  }

  // Calculate sort order among new siblings
  const siblings = allFolders.filter((f) => f.parentId === newParentId && f.id !== folderId);
  const maxOrder = siblings.reduce((max, f) => Math.max(max, f.sortOrder), -1);

  const [updated] = await db
    .update(sessionFolders)
    .set({
      parentId: newParentId,
      sortOrder: maxOrder + 1,
      updatedAt: new Date(),
    })
    .where(
      and(eq(sessionFolders.id, folderId), eq(sessionFolders.userId, userId))
    )
    .returning();

  return updated ? mapDbFolder(updated) : null;
}

/**
 * Delete a folder (sessions are moved out, not deleted)
 */
export async function deleteFolder(
  folderId: string,
  userId: string
): Promise<boolean> {
  // First, remove folder from all sessions in this folder
  await db
    .update(terminalSessions)
    .set({ folderId: null, updatedAt: new Date() })
    .where(eq(terminalSessions.folderId, folderId));

  // Then delete the folder
  const result = await db
    .delete(sessionFolders)
    .where(
      and(eq(sessionFolders.id, folderId), eq(sessionFolders.userId, userId))
    );

  return result.rowsAffected > 0;
}

/**
 * Reorder folders (update sortOrder for sibling folders).
 * Accepts an array of folder IDs in the desired order.
 * All folders must belong to the same parent (or all be root folders).
 */
export async function reorderFolders(
  userId: string,
  folderIds: string[]
): Promise<void> {
  // Use transaction for atomicity
  await db.transaction(async (tx) => {
    const now = new Date();
    // Update each folder with its new sort order
    for (let index = 0; index < folderIds.length; index++) {
      await tx
        .update(sessionFolders)
        .set({ sortOrder: index, updatedAt: now })
        .where(
          and(
            eq(sessionFolders.id, folderIds[index]),
            eq(sessionFolders.userId, userId)
          )
        );
    }
  });
}

/**
 * Move a session to a folder (or remove from folder if folderId is null).
 * SECURITY: Validates that both the session and folder belong to the user.
 */
export async function moveSessionToFolder(
  sessionId: string,
  userId: string,
  folderId: string | null
): Promise<boolean> {
  // SECURITY: Validate folder ownership before assigning
  if (folderId !== null) {
    const folder = await db.query.sessionFolders.findFirst({
      where: and(
        eq(sessionFolders.id, folderId),
        eq(sessionFolders.userId, userId)
      ),
    });

    if (!folder) {
      // Folder doesn't exist or doesn't belong to user
      return false;
    }
  }

  const result = await db
    .update(terminalSessions)
    .set({ folderId, updatedAt: new Date() })
    .where(
      and(eq(terminalSessions.id, sessionId), eq(terminalSessions.userId, userId))
    );

  return result.rowsAffected > 0;
}
