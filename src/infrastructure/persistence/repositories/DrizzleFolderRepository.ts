/**
 * DrizzleFolderRepository - Drizzle ORM implementation of FolderRepository
 *
 * This repository handles all folder persistence operations using Drizzle ORM.
 * It converts between database records and Folder domain entities using FolderMapper.
 */

import { db } from "@/db";
import { sessionFolders } from "@/db/schema";
import { eq, and, asc, desc, isNull, max } from "drizzle-orm";
import type { Folder } from "@/domain/entities/Folder";
import type {
  FolderRepository,
  FolderFilters,
  FolderOrderBy,
} from "@/application/ports/FolderRepository";
import { FolderMapper, type FolderDbRecord } from "../mappers/FolderMapper";

export class DrizzleFolderRepository implements FolderRepository {
  /**
   * Find a folder by ID with user ownership check.
   */
  async findById(id: string, userId: string): Promise<Folder | null> {
    const record = await db.query.sessionFolders.findFirst({
      where: and(
        eq(sessionFolders.id, id),
        eq(sessionFolders.userId, userId)
      ),
    });

    return record ? FolderMapper.toDomain(record as FolderDbRecord) : null;
  }

  /**
   * Find all folders for a user with optional filters and ordering.
   */
  async findByUser(
    userId: string,
    options?: {
      filters?: FolderFilters;
      orderBy?: FolderOrderBy;
    }
  ): Promise<Folder[]> {
    const conditions = [eq(sessionFolders.userId, userId)];

    // Apply filters
    if (options?.filters?.parentId !== undefined) {
      if (options.filters.parentId === null) {
        conditions.push(isNull(sessionFolders.parentId));
      } else {
        conditions.push(eq(sessionFolders.parentId, options.filters.parentId));
      }
    }

    // Build order clause
    const orderClause = this.buildOrderClause(options?.orderBy);

    const records = await db.query.sessionFolders.findMany({
      where: and(...conditions),
      orderBy: orderClause,
    });

    return FolderMapper.toDomainMany(records as FolderDbRecord[]);
  }

  /**
   * Find children of a folder.
   */
  async findChildren(parentId: string, userId: string): Promise<Folder[]> {
    return this.findByUser(userId, {
      filters: { parentId },
      orderBy: { field: "sortOrder", direction: "asc" },
    });
  }

  /**
   * Find root folders (no parent).
   */
  async findRoots(userId: string): Promise<Folder[]> {
    return this.findByUser(userId, {
      filters: { parentId: null },
      orderBy: { field: "sortOrder", direction: "asc" },
    });
  }

  /**
   * Get the ancestor chain for a folder (from immediate parent to root).
   */
  async findAncestors(folderId: string, userId: string): Promise<Folder[]> {
    // First get all folders for the user
    const allFolders = await this.findByUser(userId);
    const folderMap = new Map(allFolders.map((f) => [f.id, f]));

    // Find the starting folder
    const startFolder = folderMap.get(folderId);
    if (!startFolder) {
      return [];
    }

    // Walk up the parent chain
    const ancestors: Folder[] = [];
    let currentId = startFolder.parentId;

    while (currentId !== null) {
      const parent = folderMap.get(currentId);
      if (!parent) break;
      ancestors.push(parent);
      currentId = parent.parentId;
    }

    return ancestors;
  }

  /**
   * Get all descendant folders (recursive).
   */
  async findDescendants(folderId: string, userId: string): Promise<Folder[]> {
    // Get all folders for the user
    const allFolders = await this.findByUser(userId);

    // Build a parent→children map
    const childrenMap = new Map<string | null, Folder[]>();
    for (const folder of allFolders) {
      const children = childrenMap.get(folder.parentId) ?? [];
      children.push(folder);
      childrenMap.set(folder.parentId, children);
    }

    // Recursively collect descendants
    const descendants: Folder[] = [];
    const collectDescendants = (parentId: string) => {
      const children = childrenMap.get(parentId) ?? [];
      for (const child of children) {
        descendants.push(child);
        collectDescendants(child.id);
      }
    };

    collectDescendants(folderId);
    return descendants;
  }

  /**
   * Save a folder (insert or update).
   */
  async save(folder: Folder): Promise<Folder> {
    const data = FolderMapper.toPersistence(folder);

    // Check if exists
    const existing = await db.query.sessionFolders.findFirst({
      where: eq(sessionFolders.id, folder.id),
    });

    if (existing) {
      // Update
      const [updated] = await db
        .update(sessionFolders)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(sessionFolders.id, folder.id))
        .returning();

      return FolderMapper.toDomain(updated as FolderDbRecord);
    } else {
      // Insert
      const [inserted] = await db
        .insert(sessionFolders)
        .values(data)
        .returning();

      return FolderMapper.toDomain(inserted as FolderDbRecord);
    }
  }

  /**
   * Save multiple folders in a batch.
   */
  async saveMany(folders: Folder[]): Promise<void> {
    if (folders.length === 0) return;

    await Promise.all(folders.map((f) => this.save(f)));
  }

  /**
   * Delete a folder by ID.
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(sessionFolders)
      .where(
        and(eq(sessionFolders.id, id), eq(sessionFolders.userId, userId))
      );

    return result.rowsAffected > 0;
  }

  /**
   * Check if a folder exists.
   */
  async exists(id: string, userId: string): Promise<boolean> {
    const result = await db.query.sessionFolders.findFirst({
      where: and(
        eq(sessionFolders.id, id),
        eq(sessionFolders.userId, userId)
      ),
      columns: { id: true },
    });

    return result !== null && result !== undefined;
  }

  /**
   * Get the next available sort order among siblings.
   */
  async getNextSortOrder(
    parentId: string | null,
    userId: string
  ): Promise<number> {
    const result = await db
      .select({ maxOrder: max(sessionFolders.sortOrder) })
      .from(sessionFolders)
      .where(
        and(
          eq(sessionFolders.userId, userId),
          parentId === null
            ? isNull(sessionFolders.parentId)
            : eq(sessionFolders.parentId, parentId)
        )
      );

    const maxOrder = result[0]?.maxOrder ?? -1;
    return maxOrder + 1;
  }

  /**
   * Update sort orders for multiple folders atomically.
   */
  async updateSortOrders(
    orders: Array<{ id: string; sortOrder: number }>,
    userId: string
  ): Promise<void> {
    if (orders.length === 0) return;

    // Use transaction for atomicity
    await db.transaction(async (tx) => {
      await Promise.all(
        orders.map(({ id, sortOrder }) =>
          tx
            .update(sessionFolders)
            .set({ sortOrder, updatedAt: new Date() })
            .where(
              and(
                eq(sessionFolders.id, id),
                eq(sessionFolders.userId, userId)
              )
            )
        )
      );
    });
  }

  /**
   * Build Drizzle order clause from FolderOrderBy.
   */
  private buildOrderClause(orderBy?: FolderOrderBy) {
    if (!orderBy) {
      return [asc(sessionFolders.sortOrder)];
    }

    const column = this.getOrderColumn(orderBy.field);
    return orderBy.direction === "desc" ? [desc(column)] : [asc(column)];
  }

  /**
   * Map order field name to Drizzle column.
   */
  private getOrderColumn(field: FolderOrderBy["field"]) {
    switch (field) {
      case "sortOrder":
        return sessionFolders.sortOrder;
      case "name":
        return sessionFolders.name;
      case "createdAt":
        return sessionFolders.createdAt;
      default:
        return sessionFolders.sortOrder;
    }
  }
}
