/**
 * FolderPresenter - Transforms domain Folder entities to API responses.
 *
 * This presenter converts internal domain objects to the API contract,
 * ensuring backward compatibility with existing clients.
 */

import type { Folder } from "@/domain/entities/Folder";
import type { SessionFolder } from "@/services/folder-service";

export class FolderPresenter {
  /**
   * Convert a Folder domain entity to the API response format.
   */
  static toResponse(folder: Folder): SessionFolder {
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
   * Convert multiple Folder entities to API response format.
   */
  static toResponseMany(folders: Folder[]): SessionFolder[] {
    return folders.map((f) => FolderPresenter.toResponse(f));
  }
}
