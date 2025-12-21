/**
 * FolderService - Manages session folder CRUD operations
 */
import { db } from "@/db";
import { sessionFolders, terminalSessions } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";

export interface SessionFolder {
  id: string;
  userId: string;
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

  return folders.map((f) => ({
    id: f.id,
    userId: f.userId,
    name: f.name,
    collapsed: f.collapsed ?? false,
    sortOrder: f.sortOrder,
    createdAt: new Date(f.createdAt),
    updatedAt: new Date(f.updatedAt),
  }));
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
 * Create a new folder
 */
export async function createFolder(
  userId: string,
  name: string
): Promise<SessionFolder> {
  // Get the max sort order
  const existingFolders = await getFolders(userId);
  const maxOrder = existingFolders.reduce(
    (max, f) => Math.max(max, f.sortOrder),
    -1
  );

  const [folder] = await db
    .insert(sessionFolders)
    .values({
      userId,
      name,
      sortOrder: maxOrder + 1,
    })
    .returning();

  return {
    id: folder.id,
    userId: folder.userId,
    name: folder.name,
    collapsed: folder.collapsed ?? false,
    sortOrder: folder.sortOrder,
    createdAt: new Date(folder.createdAt),
    updatedAt: new Date(folder.updatedAt),
  };
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

  if (!updated) return null;

  return {
    id: updated.id,
    userId: updated.userId,
    name: updated.name,
    collapsed: updated.collapsed ?? false,
    sortOrder: updated.sortOrder,
    createdAt: new Date(updated.createdAt),
    updatedAt: new Date(updated.updatedAt),
  };
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
