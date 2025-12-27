/**
 * FolderMapper - Maps between database records and Folder domain entity.
 */

import { Folder, type FolderProps } from "@/domain/entities/Folder";

/**
 * Raw database record type from Drizzle query.
 * This matches the sessionFolders schema.
 */
export interface FolderDbRecord {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  collapsed: boolean | null;
  sortOrder: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Format for database insert/update operations.
 */
export interface FolderDbInsert {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export class FolderMapper {
  /**
   * Convert a database record to a Folder domain entity.
   */
  static toDomain(record: FolderDbRecord): Folder {
    const props: FolderProps = {
      id: record.id,
      userId: record.userId,
      parentId: record.parentId,
      name: record.name,
      collapsed: record.collapsed ?? false,
      sortOrder: record.sortOrder,
      createdAt: toDate(record.createdAt),
      updatedAt: toDate(record.updatedAt),
    };

    return Folder.reconstitute(props);
  }

  /**
   * Convert multiple database records to Folder domain entities.
   */
  static toDomainMany(records: FolderDbRecord[]): Folder[] {
    return records.map((r) => FolderMapper.toDomain(r));
  }

  /**
   * Convert a Folder domain entity to database insert format.
   */
  static toPersistence(folder: Folder): FolderDbInsert {
    return {
      id: folder.id,
      userId: folder.userId,
      parentId: folder.parentId,
      name: folder.name,
      collapsed: folder.collapsed,
      sortOrder: folder.sortOrder,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    };
  }

  /**
   * Convert a Folder to the API response type.
   * Used for backward compatibility with existing API responses.
   */
  static toApiResponse(folder: Folder): {
    id: string;
    userId: string;
    parentId: string | null;
    name: string;
    collapsed: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id: folder.id,
      userId: folder.userId,
      parentId: folder.parentId,
      name: folder.name,
      collapsed: folder.collapsed,
      sortOrder: folder.sortOrder,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    };
  }
}

/**
 * Helper to convert string or Date to Date.
 */
function toDate(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}
