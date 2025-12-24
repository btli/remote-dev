/**
 * Trash system types for soft-delete functionality
 */

/**
 * Supported resource types that can be trashed
 */
export type TrashResourceType = "worktree";

/**
 * Generic trash item representing any trashed resource
 */
export interface TrashItem {
  id: string;
  userId: string;
  resourceType: TrashResourceType;
  resourceId: string;
  resourceName: string;
  trashedAt: Date;
  expiresAt: Date;
}

/**
 * Worktree-specific trash metadata
 */
export interface WorktreeTrashMetadata {
  id: string;
  trashItemId: string;
  githubRepoId: string | null;
  repoName: string;
  repoLocalPath: string;
  worktreeBranch: string;
  worktreeOriginalPath: string;
  worktreeTrashPath: string;
  originalFolderId: string | null;
  originalFolderName: string | null;
  createdAt: Date;
}

/**
 * Trash item with worktree metadata (for worktree resource type)
 */
export interface WorktreeTrashItem extends TrashItem {
  resourceType: "worktree";
  metadata: WorktreeTrashMetadata;
}

/**
 * Union type for all trash items with their metadata
 */
export type TrashItemWithMetadata = WorktreeTrashItem;

/**
 * Input for trashing a worktree session
 */
export interface TrashWorktreeInput {
  sessionId: string;
}

/**
 * Options for restoring from trash
 */
export interface RestoreOptions {
  /** Override the restore path (if original path is unavailable) */
  restorePath?: string;
  /** Target folder ID for the restored session */
  targetFolderId?: string | null;
}

/**
 * Result of a restore operation
 */
export interface RestoreResult {
  sessionId: string;
  worktreePath: string;
  folderId: string | null;
}

/**
 * Summary of cleanup operation
 */
export interface CleanupResult {
  deletedCount: number;
  deletedIds: string[];
}

/**
 * Days remaining until expiry calculation
 */
export function getDaysUntilExpiry(expiresAt: Date): number {
  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * Check if a trash item has expired
 */
export function isExpired(expiresAt: Date): boolean {
  return new Date() >= expiresAt;
}
