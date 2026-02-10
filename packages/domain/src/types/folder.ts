/**
 * Folder types for session organization
 * Pure TypeScript - no React dependencies
 */

/**
 * Folder data transfer object
 */
export interface FolderDTO {
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
 * Input for creating a new folder
 */
export interface CreateFolderInput {
  name: string;
  parentId?: string | null;
}

/**
 * Input for updating a folder
 */
export interface UpdateFolderInput {
  name?: string;
  collapsed?: boolean;
  sortOrder?: number;
  parentId?: string | null;
}

/**
 * Folder with children for tree display
 */
export interface FolderTreeNode extends FolderDTO {
  children: FolderTreeNode[];
  sessions: string[]; // Session IDs in this folder
}

/**
 * Pinned file configuration stored in folder preferences
 */
export interface PinnedFile {
  path: string;
  name: string;
  icon?: string;
}
