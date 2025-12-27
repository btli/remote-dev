/**
 * FolderRepository - Port interface for folder persistence.
 *
 * This interface defines the contract for folder data access.
 * Folders are hierarchical (parent-child relationships) and support
 * preference inheritance.
 */

import type { Folder } from "@/domain/entities/Folder";

export interface FolderFilters {
  /** Filter by parent ID (null = root folders) */
  parentId?: string | null;
}

export interface FolderOrderBy {
  field: "sortOrder" | "name" | "createdAt";
  direction: "asc" | "desc";
}

export interface FolderRepository {
  /**
   * Find a folder by ID.
   * Returns null if not found or doesn't belong to user.
   */
  findById(id: string, userId: string): Promise<Folder | null>;

  /**
   * Find all folders for a user.
   */
  findByUser(
    userId: string,
    options?: {
      filters?: FolderFilters;
      orderBy?: FolderOrderBy;
    }
  ): Promise<Folder[]>;

  /**
   * Find children of a folder.
   */
  findChildren(parentId: string, userId: string): Promise<Folder[]>;

  /**
   * Find root folders (no parent).
   */
  findRoots(userId: string): Promise<Folder[]>;

  /**
   * Get the ancestor chain for a folder (from immediate parent to root).
   * Useful for preference inheritance.
   */
  findAncestors(folderId: string, userId: string): Promise<Folder[]>;

  /**
   * Get all descendant folders (recursive).
   * Useful for cascade operations.
   */
  findDescendants(folderId: string, userId: string): Promise<Folder[]>;

  /**
   * Save a folder (insert or update).
   */
  save(folder: Folder): Promise<Folder>;

  /**
   * Save multiple folders in a batch.
   */
  saveMany(folders: Folder[]): Promise<void>;

  /**
   * Delete a folder by ID.
   * Returns true if deleted, false if not found.
   * Note: This should not cascade-delete children. Caller must handle that.
   */
  delete(id: string, userId: string): Promise<boolean>;

  /**
   * Check if a folder exists.
   */
  exists(id: string, userId: string): Promise<boolean>;

  /**
   * Get the next available sort order among siblings.
   */
  getNextSortOrder(parentId: string | null, userId: string): Promise<number>;

  /**
   * Update sort orders for multiple folders atomically.
   */
  updateSortOrders(
    orders: Array<{ id: string; sortOrder: number }>,
    userId: string
  ): Promise<void>;
}
