/**
 * WorktreeTrashService - Worktree-specific trash operations
 *
 * Handles the filesystem and database operations specific to trashing,
 * restoring, and permanently deleting git worktrees.
 */

import { db } from "@/db";
import {
  trashItems,
  worktreeTrashMetadata,
  terminalSessions,
  githubRepositories,
  sessionFolders,
  folderPreferences,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { existsSync, mkdirSync, renameSync, rmSync } from "fs";
import { join, dirname, basename } from "path";
import type { TrashItem, RestoreResult } from "@/types/trash";
import * as TmuxService from "./tmux-service";
import { sanitizeBranchName, getRepoRoot } from "./worktree-service";
import { execFileNoThrow } from "@/lib/exec";
import { WorktreeTrashServiceError } from "@/lib/errors";

// Re-export for backwards compatibility
export { WorktreeTrashServiceError };

/**
 * Get the .trash directory path for a repository
 */
export function getTrashDir(repoPath: string): string {
  return join(repoPath, ".trash");
}

/**
 * Generate a unique trash path for a worktree
 */
export function generateTrashPath(
  repoPath: string,
  branch: string,
  trashedAt: Date
): string {
  const timestamp = trashedAt.getTime();
  const sanitized = sanitizeBranchName(branch);
  return join(getTrashDir(repoPath), `${sanitized}-${timestamp}`);
}

/**
 * Trash a worktree session
 * Moves the worktree to .trash directory and creates trash records
 *
 * @param sessionId - Terminal session ID with worktree
 * @param userId - User ID for authorization
 * @returns Created trash item
 */
export async function trashWorktreeSession(
  sessionId: string,
  userId: string
): Promise<TrashItem> {
  // Get session with all metadata
  const session = await db.query.terminalSessions.findFirst({
    where: and(
      eq(terminalSessions.id, sessionId),
      eq(terminalSessions.userId, userId)
    ),
  });

  if (!session) {
    throw new WorktreeTrashServiceError(
      "Session not found",
      "SESSION_NOT_FOUND",
      sessionId
    );
  }

  if (!session.projectPath || !session.worktreeBranch) {
    throw new WorktreeTrashServiceError(
      "Session does not have a worktree",
      "NO_WORKTREE",
      sessionId
    );
  }

  if (session.status === "trashed") {
    throw new WorktreeTrashServiceError(
      "Session is already trashed",
      "ALREADY_TRASHED",
      sessionId
    );
  }

  // Get repository info - use multiple strategies to find the main repo
  let repoName = "unknown";
  let repoLocalPath = "";

  // Strategy 1: Check folder preferences for localRepoPath or defaultWorkingDirectory
  if (session.folderId) {
    const prefs = await db.query.folderPreferences.findFirst({
      where: and(
        eq(folderPreferences.folderId, session.folderId),
        eq(folderPreferences.userId, userId)
      ),
    });
    if (prefs?.localRepoPath) {
      repoLocalPath = prefs.localRepoPath;
      repoName = basename(prefs.localRepoPath);
    } else if (prefs?.defaultWorkingDirectory) {
      // Check if defaultWorkingDirectory is a git repo
      const gitRoot = await getRepoRoot(prefs.defaultWorkingDirectory);
      if (gitRoot) {
        repoLocalPath = prefs.defaultWorkingDirectory;
        repoName = basename(prefs.defaultWorkingDirectory);
      }
    }
  }

  // Strategy 2: Check GitHub repo from database
  if (!repoLocalPath && session.githubRepoId) {
    const repo = await db.query.githubRepositories.findFirst({
      where: eq(githubRepositories.id, session.githubRepoId),
    });
    if (repo) {
      repoName = repo.name;
      repoLocalPath = repo.localPath || "";
    }
  }

  // Strategy 3: Use git to find the actual repo root from worktree
  if (!repoLocalPath) {
    const gitRoot = await getRepoRoot(session.projectPath);
    if (gitRoot) {
      // Git worktrees report their own path as root, so check .git file
      // A worktree has a .git FILE (not directory) pointing to the main repo
      const gitPath = join(session.projectPath, ".git");
      if (existsSync(gitPath)) {
        // This is likely a worktree - derive main repo from path pattern
        // Worktrees are typically at {repoPath}-{branch}, so main repo removes the suffix
        const parentDir = dirname(session.projectPath);
        const worktreeBasename = basename(session.projectPath);
        // Try to find the main repo by removing branch suffix
        const dashIndex = worktreeBasename.lastIndexOf("-");
        if (dashIndex > 0) {
          const possibleRepoName = worktreeBasename.substring(0, dashIndex);
          const possibleRepoPath = join(parentDir, possibleRepoName);
          if (existsSync(possibleRepoPath)) {
            repoLocalPath = possibleRepoPath;
            repoName = possibleRepoName;
          }
        }
      }
    }
  }

  // Strategy 4: Fallback - use parent directory
  if (!repoLocalPath) {
    repoLocalPath = dirname(session.projectPath);
    repoName = basename(repoLocalPath);
  }

  // Get folder info for snapshot
  let folderName: string | null = null;
  if (session.folderId) {
    const folder = await db.query.sessionFolders.findFirst({
      where: eq(sessionFolders.id, session.folderId),
    });
    if (folder) {
      folderName = folder.name;
    }
  }

  const trashedAt = new Date();
  const expiresAt = new Date(trashedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const trashPath = generateTrashPath(repoLocalPath, session.worktreeBranch, trashedAt);

  // Move worktree to trash directory
  if (existsSync(session.projectPath)) {
    const trashDir = getTrashDir(repoLocalPath);
    if (!existsSync(trashDir)) {
      mkdirSync(trashDir, { recursive: true });
    }

    try {
      renameSync(session.projectPath, trashPath);
    } catch (error) {
      const err = error as Error;
      throw new WorktreeTrashServiceError(
        "Failed to move worktree to trash",
        "MOVE_FAILED",
        err.message
      );
    }
  }

  // Kill tmux session if active
  try {
    await TmuxService.killSession(session.tmuxSessionName);
  } catch {
    // Ignore errors - tmux session may already be dead
  }

  // Create trash item record
  const [trashItem] = await db
    .insert(trashItems)
    .values({
      userId,
      resourceType: "worktree",
      resourceId: sessionId,
      resourceName: session.name,
      trashedAt,
      expiresAt,
    })
    .returning();

  // Create worktree metadata record
  await db.insert(worktreeTrashMetadata).values({
    trashItemId: trashItem.id,
    githubRepoId: session.githubRepoId,
    repoName,
    repoLocalPath,
    worktreeBranch: session.worktreeBranch,
    worktreeOriginalPath: session.projectPath,
    worktreeTrashPath: trashPath,
    originalFolderId: session.folderId,
    originalFolderName: folderName,
  });

  // Update session status to trashed
  await db
    .update(terminalSessions)
    .set({
      status: "trashed",
      folderId: null, // Remove from folder
      updatedAt: new Date(),
    })
    .where(eq(terminalSessions.id, sessionId));

  return {
    id: trashItem.id,
    userId: trashItem.userId,
    resourceType: "worktree",
    resourceId: trashItem.resourceId,
    resourceName: trashItem.resourceName,
    trashedAt: trashItem.trashedAt,
    expiresAt: trashItem.expiresAt,
  };
}

/**
 * Restore a worktree from trash
 *
 * @param trashItemId - Trash item ID
 * @param userId - User ID for authorization
 * @param restorePath - Optional override path (if original unavailable)
 * @param targetFolderId - Optional folder to restore to
 * @returns Restore result with session ID and path
 */
export async function restoreWorktreeFromTrash(
  trashItemId: string,
  userId: string,
  restorePath?: string,
  targetFolderId?: string | null
): Promise<RestoreResult> {
  // Get trash item
  const trashItem = await db.query.trashItems.findFirst({
    where: and(
      eq(trashItems.id, trashItemId),
      eq(trashItems.userId, userId)
    ),
  });

  if (!trashItem || trashItem.resourceType !== "worktree") {
    throw new WorktreeTrashServiceError(
      "Trash item not found",
      "NOT_FOUND",
      trashItemId
    );
  }

  // Get worktree metadata
  const metadata = await db.query.worktreeTrashMetadata.findFirst({
    where: eq(worktreeTrashMetadata.trashItemId, trashItemId),
  });

  if (!metadata) {
    throw new WorktreeTrashServiceError(
      "Trash metadata not found",
      "METADATA_NOT_FOUND",
      trashItemId
    );
  }

  // Verify session exists
  const session = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, trashItem.resourceId),
  });

  if (!session) {
    throw new WorktreeTrashServiceError(
      "Session record not found",
      "SESSION_NOT_FOUND",
      trashItem.resourceId
    );
  }

  // Determine restore path
  const targetPath = restorePath || metadata.worktreeOriginalPath;

  // Check if trash path exists
  if (!existsSync(metadata.worktreeTrashPath)) {
    throw new WorktreeTrashServiceError(
      "Trashed worktree directory not found",
      "TRASH_DIR_NOT_FOUND",
      metadata.worktreeTrashPath
    );
  }

  // Check if target path already exists
  if (existsSync(targetPath)) {
    throw new WorktreeTrashServiceError(
      "Restore path already exists",
      "PATH_EXISTS",
      targetPath
    );
  }

  // Create parent directory if needed
  const parentDir = dirname(targetPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Move worktree back from trash
  try {
    renameSync(metadata.worktreeTrashPath, targetPath);
  } catch (error) {
    const err = error as Error;
    throw new WorktreeTrashServiceError(
      "Failed to restore worktree from trash",
      "RESTORE_FAILED",
      err.message
    );
  }

  // Repair git worktree registration after moving directory back
  // The move breaks git's internal path references between the worktree's
  // .git file and the main repo's .git/worktrees/ entry
  if (metadata.repoLocalPath && existsSync(metadata.repoLocalPath)) {
    const repairResult = await execFileNoThrow("git", [
      "-C", metadata.repoLocalPath,
      "worktree", "repair", targetPath,
    ]);
    if (repairResult.exitCode !== 0) {
      console.warn(
        `git worktree repair failed (non-fatal): ${repairResult.stderr}`
      );
    }
  }

  // Determine target folder
  // Priority: provided targetFolderId > original folder (if still exists) > null
  let folderId: string | null = null;
  if (targetFolderId !== undefined) {
    folderId = targetFolderId;
  } else if (metadata.originalFolderId) {
    // Check if original folder still exists and belongs to this user
    const originalFolder = await db.query.sessionFolders.findFirst({
      where: and(
        eq(sessionFolders.id, metadata.originalFolderId),
        eq(sessionFolders.userId, userId)
      ),
    });
    if (originalFolder) {
      folderId = metadata.originalFolderId;
    }
  }

  // Update session back to active and delete trash records
  await db
    .update(terminalSessions)
    .set({
      status: "active",
      projectPath: targetPath,
      folderId,
      updatedAt: new Date(),
    })
    .where(eq(terminalSessions.id, trashItem.resourceId));

  await db.delete(trashItems).where(eq(trashItems.id, trashItemId));

  return {
    sessionId: trashItem.resourceId,
    worktreePath: targetPath,
    folderId,
  };
}

/**
 * Permanently delete a worktree from trash
 *
 * @param trashItemId - Trash item ID
 * @param userId - User ID for authorization
 */
export async function permanentlyDeleteWorktree(
  trashItemId: string,
  userId: string
): Promise<void> {
  // Get trash item
  const trashItem = await db.query.trashItems.findFirst({
    where: and(
      eq(trashItems.id, trashItemId),
      eq(trashItems.userId, userId)
    ),
  });

  if (!trashItem || trashItem.resourceType !== "worktree") {
    throw new WorktreeTrashServiceError(
      "Trash item not found",
      "NOT_FOUND",
      trashItemId
    );
  }

  // Get worktree metadata
  const metadata = await db.query.worktreeTrashMetadata.findFirst({
    where: eq(worktreeTrashMetadata.trashItemId, trashItemId),
  });

  // Delete from filesystem if exists
  if (metadata && existsSync(metadata.worktreeTrashPath)) {
    try {
      rmSync(metadata.worktreeTrashPath, { recursive: true, force: true });
    } catch (error) {
      const err = error as Error;
      console.error(`Failed to delete trash directory: ${err.message}`);
      // Continue with database cleanup even if filesystem delete fails
    }
  }

  // Delete the session record
  if (trashItem.resourceId) {
    await db
      .delete(terminalSessions)
      .where(eq(terminalSessions.id, trashItem.resourceId));
  }

  // Delete trash records (cascade will delete metadata)
  await db.delete(trashItems).where(eq(trashItems.id, trashItemId));
}

/**
 * Check if the original restore path is available
 *
 * @param trashItemId - Trash item ID
 * @param userId - User ID for authorization
 * @returns True if original path is available for restore
 */
export async function isOriginalPathAvailable(
  trashItemId: string,
  userId: string
): Promise<boolean> {
  const trashItem = await db.query.trashItems.findFirst({
    where: and(
      eq(trashItems.id, trashItemId),
      eq(trashItems.userId, userId)
    ),
  });

  if (!trashItem) {
    return false;
  }

  const metadata = await db.query.worktreeTrashMetadata.findFirst({
    where: eq(worktreeTrashMetadata.trashItemId, trashItemId),
  });

  if (!metadata) {
    return false;
  }

  return !existsSync(metadata.worktreeOriginalPath);
}

/**
 * Check if the original folder still exists
 *
 * @param trashItemId - Trash item ID
 * @param userId - User ID for authorization
 * @returns Original folder ID if it exists, null otherwise
 */
export async function getOriginalFolderIfExists(
  trashItemId: string,
  userId: string
): Promise<string | null> {
  const metadata = await db.query.worktreeTrashMetadata.findFirst({
    where: eq(worktreeTrashMetadata.trashItemId, trashItemId),
  });

  if (!metadata?.originalFolderId) {
    return null;
  }

  const folder = await db.query.sessionFolders.findFirst({
    where: and(
      eq(sessionFolders.id, metadata.originalFolderId),
      eq(sessionFolders.userId, userId)
    ),
  });

  return folder ? folder.id : null;
}
